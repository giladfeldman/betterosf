import type { NodeView } from "@/lib/osf/parse";
import type { SearchedFile, SearchedRegistration, SearchedUser } from "@/lib/osf/search";

export function ProjectResult({ node }: { node: NodeView }) {
  return (
    <li className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <a href={`/${node.id}`} className="text-blue-600 hover:underline font-medium">{node.title || node.id}</a>
      {node.description && <p className="text-sm text-neutral-600 mt-0.5 line-clamp-2">{node.description}</p>}
      <p className="text-xs text-neutral-500 mt-1">
        {node.category || "project"} · {node.tags.slice(0, 4).join(", ") || "no tags"} · {node.dateModified.slice(0, 10) || "unknown date"}
      </p>
    </li>
  );
}

export function FileResult({ file }: { file: SearchedFile }) {
  return (
    <li className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <a href={file.downloadUrl || (file.nodeId ? `/${file.nodeId}/files` : "#")} className="text-blue-600 hover:underline font-medium font-mono-files">
        <span aria-hidden="true">📄</span> <span>{file.name}</span>
      </a>
      <p className="text-xs text-neutral-500 mt-1">
        {file.size !== null ? `${file.size} B` : "size unknown"}
        {file.materializedPath ? ` · ${file.materializedPath}` : ""}
        {file.nodeId && (
          <>
            {" · in "}
            <a href={`/${file.nodeId}`} className="text-blue-600 hover:underline">project {file.nodeId}</a>
          </>
        )}
      </p>
    </li>
  );
}

export function RegistrationResult({ reg }: { reg: SearchedRegistration }) {
  return (
    <li className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <a href={`/registrations/${reg.id}`} className="text-blue-600 hover:underline font-medium">{reg.title || reg.id}</a>
      <p className="text-xs text-neutral-500 mt-1">
        Registered {reg.dateRegistered.slice(0, 10)} · <a href={reg.osfUrl} className="text-blue-600 hover:underline">on OSF</a>
      </p>
    </li>
  );
}

export function UserResult({ user }: { user: SearchedUser }) {
  return (
    <li className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <a href={user.osfUrl} className="text-blue-600 hover:underline font-medium">{user.fullName}</a>
      <p className="text-xs text-neutral-500 mt-1">OSF user {user.id}</p>
    </li>
  );
}
