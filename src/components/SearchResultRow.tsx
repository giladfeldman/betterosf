import type { NodeView } from "@/lib/osf/parse";
import type { SearchedFile, SearchedRegistration, SearchedUser } from "@/lib/osf/search";
import { HighlightedText, HighlightedSnippet, MatchHints } from "./HighlightedText";

export function ProjectResult({ node, terms = [] }: { node: NodeView; terms?: string[] }) {
  return (
    <li className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <a href={`/${node.id}`} className="text-blue-600 hover:underline font-medium">
        <HighlightedText text={node.title || node.id} terms={terms} />
      </a>
      {node.description && (
        <p className="text-sm text-neutral-600 mt-0.5 line-clamp-2">
          <HighlightedSnippet text={node.description} terms={terms} />
        </p>
      )}
      <p className="text-xs text-neutral-500 mt-1">
        {node.category || "project"} ·{" "}
        {node.tags.length > 0 ? <HighlightedText text={node.tags.slice(0, 4).join(", ")} terms={terms} /> : "no tags"}{" "}
        · {node.dateModified.slice(0, 10) || "unknown date"}
      </p>
      <MatchHints
        terms={terms}
        fields={{
          title: node.title,
          description: node.description,
          tags: node.tags.join(" "),
        }}
      />
    </li>
  );
}

export function FileResult({ file, terms = [] }: { file: SearchedFile; terms?: string[] }) {
  return (
    <li className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <a
        href={file.downloadUrl || (file.nodeId ? `/${file.nodeId}/files` : "#")}
        className="text-blue-600 hover:underline font-medium font-mono-files"
      >
        <span aria-hidden="true">📄</span>{" "}
        <span>
          <HighlightedText text={file.name} terms={terms} />
        </span>
      </a>
      <p className="text-xs text-neutral-500 mt-1">
        {file.size !== null ? `${file.size} B` : "size unknown"}
        {file.materializedPath ? (
          <>
            {" · "}
            <HighlightedText text={file.materializedPath} terms={terms} />
          </>
        ) : (
          ""
        )}
        {file.nodeId && (
          <>
            {" · in "}
            <a href={`/${file.nodeId}`} className="text-blue-600 hover:underline">
              project {file.nodeId}
            </a>
          </>
        )}
      </p>
      <MatchHints
        terms={terms}
        fields={{
          filename: file.name,
          path: file.materializedPath,
        }}
      />
    </li>
  );
}

export function RegistrationResult({ reg, terms = [] }: { reg: SearchedRegistration; terms?: string[] }) {
  return (
    <li className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <a href={`/registrations/${reg.id}`} className="text-blue-600 hover:underline font-medium">
        <HighlightedText text={reg.title || reg.id} terms={terms} />
      </a>
      <p className="text-xs text-neutral-500 mt-1">
        Registered {reg.dateRegistered.slice(0, 10)} ·{" "}
        <a href={reg.osfUrl} className="text-blue-600 hover:underline">
          on OSF
        </a>
      </p>
      <MatchHints terms={terms} fields={{ title: reg.title }} />
    </li>
  );
}

export function UserResult({ user, terms = [] }: { user: SearchedUser; terms?: string[] }) {
  return (
    <li className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <a href={user.osfUrl} className="text-blue-600 hover:underline font-medium">
        <HighlightedText text={user.fullName} terms={terms} />
      </a>
      <p className="text-xs text-neutral-500 mt-1">OSF user {user.id}</p>
      <MatchHints terms={terms} fields={{ fullName: user.fullName }} />
    </li>
  );
}
