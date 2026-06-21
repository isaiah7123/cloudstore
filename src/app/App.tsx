import { useState, useRef, useCallback, useEffect } from "react";
import {
  Cloud, Upload, FolderUp, X, Eye, EyeOff, FileArchive,
  CheckCircle2, FolderOpen, File, Download, Search, Image, 
  FileText, Music, Archive, Info, ChevronDown, ChevronRight, FolderClosed,
} from "lucide-react";
import { listFiles, uploadFile, getDownloadUrl, deleteFile } from "./api";
import { signIn, signUp, confirmSignUp, signOut, getCurrentUser } from "aws-amplify/auth";

// ─── Types ───────────────────────────────────────────────────────────────────

type ModalMode = "login" | "signup";

// ─── Directory Simulation ────────────────────────────────────────────────────

type TreeNode = {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  file?: any; // original file object, only present on leaf nodes
};

function buildTree(files: any[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.name.split("/").filter(Boolean);
    let level = root;
    let pathSoFar = "";

    parts.forEach((part: string, i: number) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      const isLastPart = i === parts.length - 1;
      let existing = level.find((n) => n.name === part && n.isFolder === !isLastPart);

      if (!existing) {
        existing = {
          name: part,
          path: pathSoFar,
          isFolder: !isLastPart,
          children: [],
          file: isLastPart ? file : undefined,
        };
        level.push(existing);
      }

      level = existing.children;
    });
  }

  // Sort: folders first, then alphabetical
  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(root);

  return root;
}

function TreeRow({ node, depth, onDownload, fmt }: {
  node: TreeNode;
  depth: number;
  onDownload: (filename: string) => void;
  fmt: (b: number) => string;
}) {
  const [open, setOpen] = useState(depth < 1);
  const indent = depth * 18;

  if (node.isFolder) {
    return (
      <div>
        <div
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer"
          style={{ paddingLeft: `${8 + indent}px` }}
          onClick={() => setOpen((o) => !o)}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f0eef9")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ color: "#b8aee8", display: "flex", flexShrink: 0 }}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          {open ? (
            <FolderOpen size={15} color="#f4c2d8" strokeWidth={1.8} />
          ) : (
            <FolderClosed size={15} color="#f4c2d8" strokeWidth={1.8} />
          )}
          <span
            className="flex-1 truncate"
            style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", color: "#2d2a35", fontWeight: 500 }}
          >
            {node.name}
          </span>
        </div>
        {open && node.children.map((child, i) => (
          <TreeRow key={i} node={child} depth={depth + 1} onDownload={onDownload} fmt={fmt} />
        ))}
      </div>
    );
  }

  const file = node.file;
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 group cursor-pointer"
      style={{ paddingLeft: `${8 + indent + 13}px` }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f0eef9")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <FileIcon icon={node.name.split(".").pop()} />
      <span
        className="flex-1 truncate"
        style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", color: "#4a4558" }}
      >
        {node.name}
      </span>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.72rem", color: "#b8aee8", whiteSpace: "nowrap" }}>
        {file?.modified ? new Date(file.modified).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
      </span>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.72rem", color: "#c4bedd", minWidth: "56px", textAlign: "right" }}>
        {file?.size != null ? fmt(file.size) : ""}
      </span>
      <button
        onClick={async (e) => {
          e.stopPropagation();
          onDownload(file.name);
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 ml-1"
        style={{ background: "#ede9fe", border: "none", cursor: "pointer", flexShrink: 0 }}
        title="Download"
      >
        <Download size={11} color="#7c6fcd" />
      </button>
    </div>
  );
}

// ─── Icon helper ─────────────────────────────────────────────────────────────

function FileIcon({ icon }: { icon?: string }) {
  const props = { size: 15, strokeWidth: 1.8 };
  switch (icon) {
    case "img": return <Image {...props} color="#e8a87c" />;
    case "zip": return <Archive {...props} color="#a8d8b9" />;
    case "pdf": return <FileText {...props} color="#e07b7b" />;
    case "doc": return <FileText {...props} color="#7c6fcd" />;
    case "audio": return <Music {...props} color="#f4c2d8" />;
    case "txt": return <FileText {...props} color="#8b829a" />;
    default: return <File {...props} color="#8b829a" />;
  }
}

// ─── File browser modal ──────────────────────────────────────────────────────

function FileBrowserModal({ username, onClose }: { username: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    listFiles()
      .then(setFiles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [username]);

  const filtered = query
    ? files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : files;

  const tree = buildTree(filtered);

  const fmt = (b: number) =>
    b < 1024 ? `${b} B`
    : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / 1024 ** 2).toFixed(1)} MB`;

  const handleDownload = async (filename: string) => {
    const url = await getDownloadUrl(filename);
    window.open(url, "_blank");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(45,42,53,0.35)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: "100%",
          maxWidth: "600px",
          height: "520px",
          background: "#ffffff",
          border: "1px solid #e5e0f0",
          boxShadow: "0 12px 40px rgba(124,111,205,0.12)",
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #f0eef9" }}
        >
          <div className="flex items-center gap-2">
            <FolderOpen size={17} color="#f4c2d8" strokeWidth={1.8} />
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, color: "#2d2a35", fontSize: "0.95rem" }}>
              /{username}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#8b829a" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f0eef9"; e.currentTarget.style.color = "#2d2a35"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#8b829a"; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3" style={{ borderBottom: "1px solid #f0eef9" }}>
          <div className="relative">
            <Search size={14} color="#b8aee8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              type="text"
              placeholder="Search files…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg py-2 outline-none"
              style={{
                paddingLeft: "32px",
                paddingRight: "12px",
                background: "#f7f5f2",
                border: "1px solid #e5e0f0",
                fontFamily: "'DM Mono', monospace",
                fontSize: "0.8rem",
                color: "#2d2a35",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#b8aee8")}
              onBlur={(e) => (e.target.style.borderColor = "#e5e0f0")}
            />
          </div>
        </div>

        {/* Column headers */}
        <div
          className="flex items-center gap-2 px-3 py-1.5"
          style={{ background: "#faf9fc", borderBottom: "1px solid #f0eef9" }}
        >
          <span style={{ width: 15, flexShrink: 0 }} />
          <span
            className="flex-1"
            style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.7rem", color: "#c4bedd", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Name
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.7rem", color: "#c4bedd", whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Modified
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.7rem", color: "#c4bedd", minWidth: "56px", textAlign: "right", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Size
          </span>
          <span style={{ width: 36 }} />
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", color: "#b8aee8" }}>Loading…</span>
            </div>
          ) : tree.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", color: "#b8aee8" }}>
                {query ? "No files match your search" : "No files yet"}
              </span>
            </div>
          ) : (
            tree.map((node, i) => (
              <TreeRow key={i} node={node} depth={0} onDownload={handleDownload} fmt={fmt} />
            ))
          )}
        </div>

        {/* Status bar */}
        <div
          className="px-5 py-2.5 flex items-center justify-between"
          style={{ borderTop: "1px solid #f0eef9", background: "#faf9fc" }}
        >
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.72rem", color: "#b8aee8" }}>
            {filtered.length} file{filtered.length !== 1 ? "s" : ""}
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.72rem", color: "#b8aee8" }}>
            {files.reduce((acc, f) => acc + (f.size ?? 0), 0) > 0
              ? fmt(files.reduce((acc, f) => acc + (f.size ?? 0), 0)) + " used"
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Auth modal ──────────────────────────────────────────────────────────────

function AuthModal({ mode, onClose, onSwitchMode, onLogin }: {
  mode: ModalMode;
  onClose: () => void;
  onSwitchMode: (m: ModalMode) => void;
  onLogin: (username: string) => void;
}) {

  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [submitted, setSubmitted] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    try {
      if (mode === "login") {
        const { isSignedIn } = await signIn({ username: form.email, password: form.password });
        if (isSignedIn) {
          const user = await getCurrentUser();
          onLogin(user.username);
          onClose();
        }
      } else {
        await signUp({
          username: form.username,
          password: form.password,
          options: { userAttributes: { email: form.email } },
        });
        setConfirmEmail(form.email);
        setNeedsConfirm(true);
        setSubmitted(false);
      }
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
      setSubmitted(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await confirmSignUp({ username: form.username, confirmationCode: confirmCode });
    // Auto sign in after confirmation — use email since it's the alias
    const { isSignedIn } = await signIn({ username: confirmEmail, password: form.password });
    if (isSignedIn) {
      onLogin(form.username);
      onClose();
    }
  };

  const inputStyle = {
    background: "#f7f5f2",
    border: "1px solid #e5e0f0",
    color: "#2d2a35",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.6rem",
    padding: "0.7rem 1rem",
    width: "100%",
    outline: "none",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(45,42,53,0.3)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl p-8"
        style={{
          background: "#ffffff",
          border: "1px solid #e5e0f0",
          boxShadow: "0 12px 40px rgba(124,111,205,0.1)",
        }}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 18, right: 18, background: "none", border: "none", cursor: "pointer", color: "#b8aee8" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#2d2a35")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#b8aee8")}
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 mb-7">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#ede9fe" }}>
            <Cloud size={14} color="#7c6fcd" strokeWidth={2} />
          </div>
          <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#2d2a35", fontWeight: 600, fontSize: "0.95rem" }}>
            cloudstore
          </span>
        </div>

        <p style={{ fontFamily: "'DM Sans', sans-serif", color: "#2d2a35", fontWeight: 600, fontSize: "1.2rem", marginBottom: "0.3rem" }}>
          {mode === "signup" ? "Create account" : "Welcome back"}
        </p>
        <p style={{ fontFamily: "'DM Sans', sans-serif", color: "#8b829a", fontSize: "0.875rem", marginBottom: "1.75rem" }}>
          {mode === "signup" ? "Your files, anywhere." : "Sign in to your vault."}
        </p>

        {submitted ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <CheckCircle2 size={36} color="#a8d8b9" />
            <p style={{ color: "#2d2a35", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
              {mode === "signup" ? "Account created" : "Signed in"}
            </p>
          </div>
        ) : needsConfirm ? (
          <form onSubmit={handleConfirm} className="flex flex-col gap-3">
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem", color: "#8b829a" }}>
              We sent a code to <strong>{confirmEmail}</strong>. Enter it below to verify your account.
            </p>
            <div>
              <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.78rem", color: "#8b829a", display: "block", marginBottom: "0.4rem" }}>
                Confirmation code
              </label>
              <input
                type="text"
                required
                placeholder="123456"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "#b8aee8")}
                onBlur={(e) => (e.target.style.borderColor = "#e5e0f0")}
              />
            </div>
            {error && (
              <p style={{ color: "#e07b7b", fontFamily: "'DM Sans', sans-serif", fontSize: "0.82rem" }}>
                {error}
              </p>
            )}
            <button
              type="submit"
              style={{
                marginTop: "0.5rem",
                background: "#7c6fcd",
                color: "#ffffff",
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 600,
                fontSize: "0.95rem",
                border: "none",
                borderRadius: "0.6rem",
                padding: "0.75rem",
                cursor: "pointer",
                width: "100%",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#6a5ec0")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#7c6fcd")}
            >
              Verify email
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.78rem", color: "#8b829a", display: "block", marginBottom: "0.4rem" }}>
                Email
              </label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "#b8aee8")}
                onBlur={(e) => (e.target.style.borderColor = "#e5e0f0")}
              />
            </div>

            {mode === "signup" && (
              <div>
                <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.78rem", color: "#8b829a", display: "block", marginBottom: "0.4rem" }}>
                  Username
                </label>
                <input
                  type="text"
                  required
                  placeholder="yourhandle"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  style={inputStyle}
                  onFocus={(e) => (e.target.style.borderColor = "#b8aee8")}
                  onBlur={(e) => (e.target.style.borderColor = "#e5e0f0")}
                />
              </div>
            )}

            <div>
              <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.78rem", color: "#8b829a", display: "block", marginBottom: "0.4rem" }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  style={{ ...inputStyle, paddingRight: "2.5rem" }}
                  onFocus={(e) => (e.target.style.borderColor = "#b8aee8")}
                  onBlur={(e) => (e.target.style.borderColor = "#e5e0f0")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#b8aee8" }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && (
              <p style={{ color: "#e07b7b", fontFamily: "'DM Sans', sans-serif", fontSize: "0.82rem" }}>
                {error}
              </p>
            )}
            <button
              type="submit"
              style={{
                marginTop: "0.5rem",
                background: "#7c6fcd",
                color: "#ffffff",
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 600,
                fontSize: "0.95rem",
                border: "none",
                borderRadius: "0.6rem",
                padding: "0.75rem",
                cursor: "pointer",
                width: "100%",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#6a5ec0")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#7c6fcd")}
            >
              {mode === "signup" ? "Create account" : "Sign in"}
            </button>

            <p style={{ textAlign: "center", fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem", color: "#8b829a", marginTop: "0.25rem" }}>
              {mode === "signup" ? "Already have an account? " : "No account? "}
              <button
                type="button"
                onClick={() => onSwitchMode(mode === "signup" ? "login" : "signup")}
                style={{ color: "#7c6fcd", fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                {mode === "signup" ? "Sign in" : "Create one"}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Upload zone ─────────────────────────────────────────────────────────────

function UploadZone({ onUploaded, storageClass }: { onUploaded?: () => void; storageClass: string }) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<{ name: string; size: string; status: "uploading" | "done" | "error" }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const fmt = (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`;

  const add = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const fileArr = Array.from(files);

    setUploads((prev) => [
      ...prev,
      ...fileArr.map((f) => ({ name: f.name, size: fmt(f.size), status: "uploading" as const })),
    ]);

    for (const file of fileArr) {
      try {
        // webkitRelativePath is populated when uploading via folder picker, e.g. "myfolder/sub/file.txt"
        const relativePath = (file as any).webkitRelativePath || undefined;
        await uploadFile(file, storageClass, relativePath);
        setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "done" } : u));
      } catch {
        setUploads((prev) => prev.map((u) => u.name === file.name ? { ...u, status: "error" } : u));
      }
    }
    onUploaded?.();
  }, [storageClass]);

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); add(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className="flex flex-col items-center justify-center gap-3 rounded-2xl cursor-pointer transition-all"
        style={{
          border: `1.5px dashed ${isDragging ? "#b8aee8" : "#d9d4f0"}`,
          background: isDragging ? "#f0eef9" : "#faf9fc",
          padding: "2.5rem 1.5rem",
          minHeight: "180px",
        }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: isDragging ? "#ede9fe" : "#f0eef9" }}
        >
          <Upload size={22} color="#7c6fcd" strokeWidth={1.8} />
        </div>
        <div className="text-center">
          <p style={{ fontFamily: "'DM Sans', sans-serif", color: "#2d2a35", fontWeight: 500, fontSize: "0.95rem" }}>
            Drop files here or click to browse
          </p>
          <p style={{ fontFamily: "'DM Sans', sans-serif", color: "#8b829a", fontSize: "0.82rem", marginTop: "0.2rem" }}>
            Any file type, any size
          </p>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 transition-colors"
          style={{ background: "#7c6fcd", color: "#fff", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "0.875rem", border: "none", cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#6a5ec0")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#7c6fcd")}
        >
          <Upload size={15} /> Upload files
        </button>
        <button
          onClick={() => folderRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 transition-colors"
          style={{ background: "#f0eef9", color: "#7c6fcd", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "0.875rem", border: "1px solid #d9d4f0", cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#f0eef9")}
        >
          <FolderUp size={15} /> Upload folder
        </button>
        <input ref={folderRef} type="file"
          // @ts-ignore
          webkitdirectory="true"
          multiple className="hidden" onChange={(e) => add(e.target.files)} />
      </div>

      {uploads.length > 0 && (
        <div className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: "#f7f5f2", border: "1px solid #e5e0f0" }}>
          <div className="flex items-center justify-between">
            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.7rem", color: "#8b829a", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {uploads.filter((u) => u.status === "uploading").length > 0
                ? `Uploading ${uploads.filter((u) => u.status === "uploading").length} file${uploads.filter((u) => u.status === "uploading").length > 1 ? "s" : ""}…`
                : `${uploads.filter((u) => u.status === "done").length} uploaded`}
            </p>
            <button
              onClick={() => setUploads([])}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#c4bedd", fontSize: "0.7rem", fontFamily: "'DM Sans', sans-serif" }}
            >
              Clear
            </button>
          </div>
          {uploads.slice(-4).map((u, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {u.status === "uploading" && (
                  <div
                    style={{
                      width: 12, height: 12, borderRadius: "50%",
                      border: "2px solid #b8aee8",
                      borderTopColor: "transparent",
                      animation: "spin 0.8s linear infinite",
                      flexShrink: 0,
                    }}
                  />
                )}
                {u.status === "done" && <CheckCircle2 size={12} color="#a8d8b9" />}
                {u.status === "error" && <X size={12} color="#e07b7b" />}
                <span className="truncate" style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.78rem", color: "#2d2a35" }}>
                  {u.name}
                </span>
              </div>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.72rem", color: "#8b829a", whiteSpace: "nowrap" }}>
                {u.size}
              </span>
            </div>
          ))}
          {uploads.length > 4 && (
            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.72rem", color: "#8b829a" }}>
              +{uploads.length - 4} more
            </p>
          )}
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Browse Files ────────────────────────────────────────────────────────────

function BrowseFiles({ username, onBrowse, refresh }: { username: string | null; onBrowse: () => void; refresh: number }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    listFiles()
      .then(setFiles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [username, refresh]);

  if (!username) return null;

  return (
    <>
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid #f0eef9", background: "#faf9fc", maxHeight: "180px", overflowY: "auto", position: "relative" }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.75rem", color: "#b8aee8" }}>Loading…</span>
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.75rem", color: "#b8aee8" }}>No files yet</span>
          </div>
        ) : (
          files.slice(0, 6).map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2"
              style={{ borderBottom: i < Math.min(files.length, 6) - 1 ? "1px solid #f0eef9" : "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0eef9")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <FileIcon icon={file.name.split(".").pop()} />
              <span
                className="flex-1 truncate"
                style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.75rem", color: "#4a4558" }}
              >
                {file.name}
              </span>
              {file.size != null && (
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.68rem", color: "#c4bedd", whiteSpace: "nowrap" }}>
                  {file.size < 1024 ? `${file.size} B`
                    : file.size < 1024 ** 2 ? `${(file.size / 1024).toFixed(1)} KB`
                    : `${(file.size / 1024 ** 2).toFixed(1)} MB`}
                </span>
              )}
            </div>
          ))
        )}
        <div
          style={{
            position: "sticky", bottom: 0, left: 0, right: 0,
            height: "40px",
            background: "linear-gradient(to bottom, transparent, #faf9fc)",
            pointerEvents: "none",
          }}
        />
      </div>
      <button
        onClick={() => onBrowse()}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 transition-colors"
        style={{ background: "#f0eef9", color: "#7c6fcd", border: "1px solid #d9d4f0", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", marginTop: "8px" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#f0eef9")}
      >
        <FolderOpen size={15} /> Browse my files
      </button>
    </>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [infrequentAccess, setInfrequentAccess] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then((user) => setUsername(user.username))
      .catch(() => {});
  }, []);

  const handleLogin = (u: string) => setUsername(u);
  const handleLogout = async () => {
    await signOut();
    setUsername(null);
    setShowFiles(false);
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "#f7f5f2", fontFamily: "'DM Sans', sans-serif" }}
    >
      <style>{`
        .cloudstore-grid {
          display: grid;
          gap: 5rem;
          grid-template-columns: 1fr 1fr;
          align-items: start;
        }
        @media (max-width: 768px) {
          .cloudstore-grid {
            grid-template-columns: 1fr;
            gap: 2.5rem;
          }
          .cloudstore-left { order: 2; }
          .cloudstore-right { order: 1; }
        }
      `}</style>
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-8 py-5 max-w-5xl mx-auto"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#ede9fe" }}>
            <Cloud size={14} color="#7c6fcd" strokeWidth={2} />
          </div>
          <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#2d2a35", fontWeight: 600, letterSpacing: "-0.01em" }}>
            cloudstore
          </span>
        </div>

        <div className="flex items-center gap-3">
          {username ? (
            <>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.875rem", color: "#8b829a" }}>
                hi,{" "}
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.875rem", fontWeight: "bold", color: "#8b829a", marginRight: "1.25rem" }}>
                  {username?.charAt(0).toUpperCase() + username?.slice(1)}
                </span>
              </span>
              <button
                onClick={handleLogout}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#8b829a", fontFamily: "'DM Sans', sans-serif", fontSize: "0.875rem" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#2d2a35")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#8b829a")}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setModalMode("login")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#8b829a", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: "0.875rem", padding: "0.5rem 0.75rem" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#2d2a35")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#8b829a")}
              >
                Sign in
              </button>
              <button
                onClick={() => setModalMode("signup")}
                style={{ background: "#7c6fcd", color: "#fff", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "0.875rem", border: "none", borderRadius: "0.6rem", padding: "0.5rem 1.1rem", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#6a5ec0")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#7c6fcd")}
              >
                Create account
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-8 pt-16 pb-28">
        <div className="cloudstore-grid">

          {/* Left */}
          <div className="flex flex-col gap-10 cloudstore-left">
            <div>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.8rem", color: "#b8aee8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "1.25rem" }}>
                Cloud storage
              </p>
              <h1
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  color: "#2d2a35",
                  fontWeight: 600,
                  fontSize: "clamp(2rem, 3.5vw, 2.75rem)",
                  lineHeight: 1.2,
                  letterSpacing: "-0.03em",
                  marginBottom: "1rem",
                }}
              >
                Your files,<br />
                <span style={{ color: "#7c6fcd" }}>always there.</span>
              </h1>
              <p style={{ color: "#8b829a", fontSize: "1rem", lineHeight: 1.7, maxWidth: "380px" }}>
                Cloudstore is a simple, free cloud storage service. Upload files and folders from any device
                and retrieve them whenever you need.
              </p>
            </div>

            {/* Compress tip */}
            <div
              className="flex gap-3 rounded-xl p-4"
              style={{ background: "#fffbf0", border: "1px solid #f0dfa0" }}
            >
              <FileArchive size={17} color="#d4a820" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ color: "#8a6c10", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.2rem" }}>
                  Tip: compress before uploading
                </p>
                <p style={{ color: "#b09040", fontFamily: "'DM Sans', sans-serif", fontSize: "0.82rem", lineHeight: 1.6 }}>
                  Bundling files into a{" "}
                  <code style={{ background: "rgba(212,168,32,0.12)", padding: "0 4px", borderRadius: "3px", fontFamily: "'DM Mono', monospace" }}>.zip</code>{" "}
                  or{" "}
                  <code style={{ background: "rgba(212,168,32,0.12)", padding: "0 4px", borderRadius: "3px", fontFamily: "'DM Mono', monospace" }}>.tar.gz</code>{" "}
                  archive before uploading saves bandwidth and keeps your storage tidy — files can shrink by up to 70%.
                </p>
              </div>
            </div>

            {/* Feature list */}
            <div className="flex flex-col gap-3">
              {[
                { color: "#f4c2d8", label: "Upload files and whole folders" },
                { color: "#a8d8b9", label: "Retrieve files any time, from any device" },
                { color: "#b8aee8", label: "Encrypted in transit and at rest" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#4a4558", fontSize: "0.9rem" }}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Upload card */}
          <div
            className="rounded-2xl p-6 cloudstore-right"
            style={{
              background: "#ffffff",
              border: "1px solid #e5e0f0",
              boxShadow: "0 2px 20px rgba(124,111,205,0.06)",
            }}
          >
            {username ? (
              <>
                <div className="flex items-center justify-between mb-5">
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, color: "#2d2a35", fontSize: "0.95rem" }}>
                    Upload
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setInfrequentAccess((v) => !v)}
                      className="flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors"
                      style={{
                        background: infrequentAccess ? "#ede9fe" : "#f7f5f2",
                        border: `1px solid ${infrequentAccess ? "#d9d4f0" : "#e5e0f0"}`,
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          width: 28, height: 16, borderRadius: 999,
                          background: infrequentAccess ? "#7c6fcd" : "#d9d4f0",
                          position: "relative",
                          transition: "background 0.15s",
                        }}
                      >
                        <div
                          style={{
                            width: 12, height: 12, borderRadius: "50%",
                            background: "#fff",
                            position: "absolute", top: 2,
                            left: infrequentAccess ? 14 : 2,
                            transition: "left 0.15s",
                          }}
                        />
                      </div>
                      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.78rem", color: "#4a4558", fontWeight: 500 }}>
                        Infrequent Access
                      </span>
                      <div
                      className="relative group"
                      style={{ display: "flex", alignItems: "center" }}
                    >
                      <Info size={14} color="#b8aee8" style={{ cursor: "help" }} />
                      <div
                        className="opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"
                        style={{
                          position: "absolute",
                          top: "calc(100% + 8px)",
                          right: 0,
                          width: "220px",
                          background: "#2d2a35",
                          color: "#fff",
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: "0.75rem",
                          lineHeight: 1.5,
                          padding: "0.6rem 0.75rem",
                          borderRadius: "0.5rem",
                          zIndex: 10,
                          boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                        }}
                      >
                        Enable for files that will be downloaded rarely (No less than once every 90 days)
                      </div>
                    </div>
                    </button>
                  </div>
                </div>
                <UploadZone onUploaded={() => setFileRefresh((n) => n + 1)} storageClass={infrequentAccess ? "GLACIER_IR" : "STANDARD"} />
                {/* Directory preview */}
                <div className="mt-5 pt-5" style={{ borderTop: "1px solid #f0eef9" }}>
                  <div className="mb-3">
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, color: "#2d2a35", fontSize: "0.95rem" }}>
                      Files
                    </p>
                  </div>
                  <BrowseFiles username={username} onBrowse={() => setShowFiles(true)} refresh={fileRefresh} />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "#f0eef9" }}>
                  <Cloud size={22} color="#b8aee8" strokeWidth={1.8} />
                </div>
                <div className="text-center">
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, color: "#2d2a35", fontSize: "0.95rem", marginBottom: "0.3rem" }}>
                    Sign in to get started
                  </p>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.82rem", color: "#8b829a" }}>
                    Upload and browse your files from anywhere.
                  </p>
                </div>
                <button
                  onClick={() => setModalMode("signup")}
                  style={{ background: "#7c6fcd", color: "#fff", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "0.875rem", border: "none", borderRadius: "0.6rem", padding: "0.6rem 1.4rem", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#6a5ec0")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#7c6fcd")}
                >
                  Create account
                </button>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.78rem", color: "#b8aee8", textAlign: "center" }}>
                  Already have an account? {" "}
                  <button
                    onClick={() => setModalMode("login")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#8b829a", fontFamily: "'DM Sans', sans-serif", fontSize: "0.82rem" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#2d2a35")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#8b829a")}
                  >
                    Sign in
                  </button>
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        className="px-8 py-5"
        style={{ borderTop: "1px solid #e5e0f0" }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "#ede9fe" }}>
              <Cloud size={10} color="#7c6fcd" strokeWidth={2} />
            </div>
            <span style={{ fontFamily: "'DM Sans', sans-serif", color: "#b8aee8", fontSize: "0.8rem" }}>
              © 2026 Cloudstore
            </span>
          </div>
        </div>
      </footer>

      {/* Modals */}
      {modalMode && (
        <AuthModal
          mode={modalMode}
          onClose={() => setModalMode(null)}
          onSwitchMode={setModalMode}
          onLogin={handleLogin}
        />
      )}

      {showFiles && username && (
        <FileBrowserModal username={username} onClose={() => setShowFiles(false)} />
      )}
    </div>
  );
}
