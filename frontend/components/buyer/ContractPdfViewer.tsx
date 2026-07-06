"use client";
import { useState } from "react";
import { ExternalLink, Loader2, FileText, Download } from "lucide-react";

interface Props {
  downloadUrl: string;
}

export default function ContractPdfViewer({ downloadUrl }: Props) {
  const [viewMode, setViewMode] = useState<"iframe" | "download">("iframe");
  const [loaded,   setLoaded]   = useState(false);
  const [error,    setError]    = useState(false);

  function toggleMode() {
    setViewMode(viewMode === "iframe" ? "download" : "iframe");
    setLoaded(false);
    setError(false);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6" data-testid="contract-pdf-viewer">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FileText size={15} className="text-al-primary" />
          Contract Document
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMode}
            className="text-xs text-[#6B7280] hover:text-al-primary transition-colors px-2 py-1 rounded-lg hover:bg-al-primary-subtle"
          >
            {viewMode === "iframe" ? "View as download" : "View inline"}
          </button>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-al-primary hover:text-al-primary-hover px-3 py-1.5 bg-al-primary-subtle rounded-lg transition-colors"
            data-testid="contract-open-new-tab-btn"
          >
            <ExternalLink size={12} /> Open in new tab
          </a>
        </div>
      </div>

      {viewMode === "iframe" ? (
        <div className="relative" style={{ height: 600 }}>
          {!loaded && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#F8F9FB]">
              <Loader2 size={24} className="animate-spin text-al-primary" />
              <span className="ml-2 text-sm text-[#6B7280]">Loading document…</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#F8F9FB] gap-3">
              <FileText size={32} className="text-slate-300" />
              <p className="text-sm text-slate-500">Inline preview unavailable</p>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-al-primary hover:text-al-primary-hover px-3 py-1.5 bg-al-primary-subtle rounded-lg transition-colors"
              >
                <Download size={12} /> Download instead
              </a>
            </div>
          )}
          <iframe
            src={downloadUrl}
            className="w-full h-full border-0"
            style={{ display: loaded && !error ? "block" : "none" }}
            onLoad={() => setLoaded(true)}
            onError={() => { setError(true); setLoaded(false); }}
            title="Contract Document"
            data-testid="contract-pdf-iframe"
          />
        </div>
      ) : (
        <div className="p-8 text-center">
          <FileText size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">Download the contract to view it on your device.</p>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors"
            data-testid="contract-download-btn"
          >
            <Download size={14} /> Download Contract
          </a>
        </div>
      )}
    </div>
  );
}
