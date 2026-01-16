"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { Edit, Save, X } from "lucide-react";

interface FileDiffViewerProps {
  path: string;
  status: "added" | "modified" | "deleted";
  before?: string;
  after?: string;
  editable?: boolean;
  onEdit?: (newContent: string) => void;
  ownerEdit?: boolean; // If true, owner can edit the "after" content
  isBinary?: boolean;
  mimeType?: string;
}

export function FileDiffViewer({
  path,
  status,
  before,
  after,
  editable = false,
  onEdit,
  ownerEdit = false,
  isBinary = false,
  mimeType,
}: FileDiffViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(after || "");
  // Prefer monospace for code, but use normal font for plain text like .txt
  const isMonospace = !/\.txt$/i.test(path || "");

  const guessMimeType = (): string => {
    if (mimeType) return mimeType;
    const extension = path?.split(".").pop()?.toLowerCase() || "";
    const imageTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      bmp: "image/bmp",
      avif: "image/avif",
    };
    if (imageTypes[extension]) return imageTypes[extension];
    const mimeMap: Record<string, string> = {
      pdf: "application/pdf",
      mp4: "video/mp4",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      zip: "application/zip",
      gz: "application/gzip",
      bz2: "application/x-bzip2",
      tar: "application/x-tar",
    };
    if (mimeMap[extension]) return mimeMap[extension];
    if (extension === "json" || extension === "txt") return "text/plain";
    return "application/octet-stream";
  };

  const resolvedMimeType = guessMimeType();
  const shouldRenderBinaryPreview = Boolean(isBinary && (after || before));
  const binaryDataUrl =
    shouldRenderBinaryPreview && after
      ? after.startsWith("data:")
        ? after
        : `data:${resolvedMimeType};base64,${after}`
      : null;
  const isImage = !!binaryDataUrl && resolvedMimeType.startsWith("image/");

  const handleSave = () => {
    if (onEdit) {
      onEdit(editedContent);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedContent(after || "");
    setIsEditing(false);
  };

  // Simple line-by-line diff (basic implementation)
  const calculateDiff = (beforeText: string = "", afterText: string = "") => {
    if (!beforeText && !afterText) return [];

    const beforeLines = (beforeText || "").split("\n");
    const afterLines = (afterText || "").split("\n");
    const diff: Array<{
      line: string;
      type: "removed" | "added" | "unchanged";
      lineNumber?: number;
    }> = [];

    let beforeIdx = 0;
    let afterIdx = 0;

    while (beforeIdx < beforeLines.length || afterIdx < afterLines.length) {
      const beforeLine =
        beforeIdx < beforeLines.length ? beforeLines[beforeIdx] : undefined;
      const afterLine =
        afterIdx < afterLines.length ? afterLines[afterIdx] : undefined;

      if (beforeIdx >= beforeLines.length && afterLine !== undefined) {
        // Only after lines left
        diff.push({ line: afterLine, type: "added", lineNumber: afterIdx + 1 });
        afterIdx++;
      } else if (afterIdx >= afterLines.length && beforeLine !== undefined) {
        // Only before lines left
        diff.push({
          line: beforeLine,
          type: "removed",
          lineNumber: beforeIdx + 1,
        });
        beforeIdx++;
      } else if (
        beforeLine !== undefined &&
        afterLine !== undefined &&
        beforeLine === afterLine
      ) {
        // Unchanged line
        diff.push({
          line: beforeLine,
          type: "unchanged",
          lineNumber: beforeIdx + 1,
        });
        beforeIdx++;
        afterIdx++;
      } else if (beforeLine !== undefined && afterLine !== undefined) {
        // Check if line was moved (simple check: next line matches)
        const nextBefore =
          beforeIdx + 1 < beforeLines.length
            ? beforeLines[beforeIdx + 1]
            : undefined;
        const nextAfter =
          afterIdx + 1 < afterLines.length
            ? afterLines[afterIdx + 1]
            : undefined;

        if (nextBefore !== undefined && nextBefore === afterLine) {
          diff.push({
            line: beforeLine,
            type: "removed",
            lineNumber: beforeIdx + 1,
          });
          beforeIdx++;
        } else if (nextAfter !== undefined && beforeLine === nextAfter) {
          diff.push({
            line: afterLine,
            type: "added",
            lineNumber: afterIdx + 1,
          });
          afterIdx++;
        } else {
          // Changed line
          diff.push({
            line: beforeLine,
            type: "removed",
            lineNumber: beforeIdx + 1,
          });
          diff.push({
            line: afterLine,
            type: "added",
            lineNumber: afterIdx + 1,
          });
          beforeIdx++;
          afterIdx++;
        }
      } else {
        // Fallback: should not reach here, but break to prevent infinite loop
        break;
      }
    }

    return diff;
  };

  const diffLines =
    before !== undefined && after !== undefined
      ? calculateDiff(before, after)
      : [];

  return (
    <div className="border border-gray-700 rounded">
      {/* File Header */}
      <div className="p-4 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge
            className={
              status === "added"
                ? "bg-green-600"
                : status === "deleted"
                ? "bg-red-600"
                : "bg-yellow-600"
            }
          >
            {status}
          </Badge>
          <code className="text-sm text-purple-400 font-mono">{path}</code>
        </div>
        {ownerEdit && !isEditing && after !== undefined && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsEditing(true)}
            className="text-xs"
          >
            <Edit className="h-3 w-3 mr-1" />
            Edit
          </Button>
        )}
        {isEditing && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={handleSave}
              className="text-xs bg-green-600 hover:bg-green-700"
            >
              <Save className="h-3 w-3 mr-1" />
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              className="text-xs"
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Diff Content */}
      {isEditing ? (
        <div className="p-4">
          <Textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="font-mono text-sm min-h-[40vh] bg-[#0E1116] border-[#383B42] text-white"
            rows={20}
          />
          <p className="text-xs text-gray-400 mt-2">
            Edit the file content. Your changes will be applied when merging the
            PR.
          </p>
        </div>
      ) : shouldRenderBinaryPreview ? (
        <div className="p-4 space-y-3">
          <div className="text-sm text-gray-300">
            Binary file ({resolvedMimeType || "binary"}) – diffs are not shown.
          </div>
          {isImage && binaryDataUrl ? (
            <div className="rounded border border-gray-700 bg-black/40 p-2 flex justify-center">
              <img
                src={binaryDataUrl}
                alt={path}
                className="max-h-[50vh] object-contain"
              />
            </div>
          ) : (
            <div className="rounded border border-gray-700 bg-black/40 p-4 text-sm text-gray-400">
              Preview not available.{" "}
              {binaryDataUrl ? (
                <a
                  href={binaryDataUrl}
                  download={path.split("/").pop() || "file.bin"}
                  className="text-purple-400 hover:text-purple-300 underline"
                >
                  Download file
                </a>
              ) : (
                <span>
                  {status === "deleted"
                    ? "File was deleted."
                    : "No preview data available."}
                </span>
              )}
            </div>
          )}
          {after && !isImage && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer text-purple-300">
                View raw base64
              </summary>
              <pre className="mt-2 bg-[#0E1116] p-3 rounded max-h-[30vh] overflow-auto">
                {after}
              </pre>
            </details>
          )}
        </div>
      ) : (
        <>
          {diffLines.length > 0 ? (
            // Unified diff view with line-by-line highlighting
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full border-collapse">
                <tbody>
                  {diffLines.map((line, idx) => (
                    <tr
                      key={idx}
                      className={`${
                        line.type === "added"
                          ? "bg-green-900/20"
                          : line.type === "removed"
                          ? "bg-red-900/20"
                          : "bg-transparent hover:bg-gray-800/30"
                      }`}
                    >
                      <td className="w-12 px-2 py-1 text-xs text-gray-500 text-right border-r border-gray-700 select-none">
                        {line.type === "removed" || line.type === "unchanged"
                          ? line.lineNumber
                          : ""}
                      </td>
                      <td className="w-12 px-2 py-1 text-xs text-gray-500 text-right border-r border-gray-700 select-none">
                        {line.type === "added" || line.type === "unchanged"
                          ? line.lineNumber
                          : ""}
                      </td>
                      <td
                        className={`px-4 py-1 text-sm ${
                          isMonospace ? "font-mono" : ""
                        } whitespace-pre-wrap`}
                      >
                        <span
                          className={
                            line.type === "added"
                              ? "text-green-300"
                              : line.type === "removed"
                              ? "text-red-300 line-through"
                              : "text-gray-300"
                          }
                        >
                          {line.type === "removed" || line.type === "added" ? (
                            <>
                              <span className="inline-block w-2 mr-2">
                                {line.type === "added" ? "+" : "-"}
                              </span>
                            </>
                          ) : null}
                          {line.line}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            // Side-by-side view if no diff calculation
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
              {before !== undefined && (
                <div>
                  <div className="p-2 bg-[#0E1116] border-r border-gray-700 text-xs text-gray-400 font-semibold">
                    Before
                  </div>
                  <pre
                    className={`bg-[#0E1116] p-4 overflow-auto text-sm ${
                      isMonospace ? "font-mono" : "font-sans"
                    } whitespace-pre-wrap text-gray-300 border-r border-gray-700 max-h-[40vh]`}
                  >
                    {before}
                  </pre>
                </div>
              )}
              {after !== undefined && (
                <div>
                  <div className="p-2 bg-[#0E1116] text-xs text-gray-400 font-semibold">
                    After
                  </div>
                  <pre
                    className={`bg-[#0E1116] p-4 overflow-auto text-sm ${
                      isMonospace ? "font-mono" : "font-sans"
                    } whitespace-pre-wrap text-gray-100 max-h-[40vh]`}
                  >
                    {after}
                  </pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
