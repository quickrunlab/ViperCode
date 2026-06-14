import type { CheckpointFile } from "../thread/threadTypes.ts";

export interface DiffStat {
  additions: number;
  deletions: number;
}

export interface FileTreeNode {
  kind: "directory" | "file";
  name: string;
  path: string;
  stat: DiffStat;
  children: FileTreeNode[];
}

const SORT_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, SORT_OPTIONS);
}

function normalizePathSegments(pathValue: string): string[] {
  return pathValue
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

interface MutableDirNode {
  name: string;
  path: string;
  stat: DiffStat;
  dirs: Map<string, MutableDirNode>;
  files: { name: string; path: string; stat: DiffStat }[];
}

function compactDirectory(node: FileTreeNode): FileTreeNode {
  const compacted = node.children.map((child) =>
    child.kind === "directory" ? compactDirectory(child) : child,
  );

  let current: FileTreeNode = { ...node, children: compacted };

  while (current.children.length === 1 && current.children[0]?.kind === "directory") {
    const child = current.children[0]!;
    current = {
      kind: "directory",
      name: `${current.name}/${child.name}`,
      path: child.path,
      stat: child.stat,
      children: child.children,
    };
  }

  return current;
}

function toTreeNodes(dir: MutableDirNode): FileTreeNode[] {
  const subs: FileTreeNode[] = Array.from(dir.dirs.values())
    .sort(compareByName)
    .map<FileTreeNode>((sub) => ({
      kind: "directory",
      name: sub.name,
      path: sub.path,
      stat: { additions: sub.stat.additions, deletions: sub.stat.deletions },
      children: toTreeNodes(sub),
    }))
    .map((sub) => compactDirectory(sub));

  const files: FileTreeNode[] = dir.files.sort(compareByName).map((f) => ({
    kind: "file",
    name: f.name,
    path: f.path,
    stat: f.stat,
    children: [],
  }));

  return [...subs, ...files];
}

export function buildFileTree(files: ReadonlyArray<CheckpointFile>): FileTreeNode[] {
  const root: MutableDirNode = {
    name: "",
    path: "",
    stat: { additions: 0, deletions: 0 },
    dirs: new Map(),
    files: [],
  };

  for (const file of files) {
    const segments = normalizePathSegments(file.path);
    if (segments.length === 0) continue;

    const filePath = segments.join("/");
    const fileName = segments.at(-1);
    if (!fileName) continue;

    const stat: DiffStat = file.hasStat
      ? { additions: file.additions, deletions: file.deletions }
      : { additions: 0, deletions: 0 };

    const ancestors: MutableDirNode[] = [root];
    let current = root;

    for (const segment of segments.slice(0, -1)) {
      const nextPath = current.path ? `${current.path}/${segment}` : segment;
      const existing = current.dirs.get(segment);
      if (existing) {
        current = existing;
      } else {
        const created: MutableDirNode = {
          name: segment,
          path: nextPath,
          stat: { additions: 0, deletions: 0 },
          dirs: new Map(),
          files: [],
        };
        current.dirs.set(segment, created);
        current = created;
      }
      ancestors.push(current);
    }

    current.files.push({ name: fileName, path: filePath, stat });

    for (const ancestor of ancestors) {
      ancestor.stat.additions += stat.additions;
      ancestor.stat.deletions += stat.deletions;
    }
  }

  return toTreeNodes(root);
}
