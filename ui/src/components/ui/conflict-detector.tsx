"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Conflict } from "@/lib/git/conflict-detection";

import { AlertCircle, Check, GitMerge, X } from "lucide-react";

interface ConflictDetectorProps {
  conflicts: Conflict[];
  onResolve: (
    conflicts: Conflict[],
    resolutions: Record<string, "pr" | "base" | string>
  ) => void;
  onCancel: () => void;
}

export function ConflictDetector({
  conflicts,
  onResolve,
  onCancel,
}: ConflictDetectorProps) {
  const [resolutions, setResolutions] = useState<
    Record<string, "pr" | "base" | "manual">
  >({});
  const [manualResolutions, setManualResolutions] = useState<
    Record<string, string>
  >({});

  const handleResolve = () => {
    const finalResolutions: Record<string, "pr" | "base" | string> = {};

    for (const conflict of conflicts) {
      const resolution = resolutions[conflict.path];
      if (resolution === "manual") {
        finalResolutions[conflict.path] =
          manualResolutions[conflict.path] || conflict.prContent || "";
      } else {
        finalResolutions[conflict.path] = resolution || "pr";
      }
    }

    onResolve(conflicts, finalResolutions);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-red-600 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="h-6 w-6 text-red-500" />
          <h2 className="text-xl font-bold text-red-400">
            Merge Conflicts Detected
          </h2>
        </div>

        <p className="text-gray-300 mb-6">
          This PR has conflicts with the target branch that must be resolved
          before merging.
        </p>

        <div className="space-y-4 mb-6">
          {conflicts.map((conflict, idx) => (
            <div
              key={idx}
              className="border border-red-700 rounded p-4 bg-red-900/10"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-red-300">
                    {conflict.path}
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">
                    {conflict.message}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={
                      resolutions[conflict.path] === "pr"
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      setResolutions({ ...resolutions, [conflict.path]: "pr" })
                    }
                    className={
                      resolutions[conflict.path] === "pr"
                        ? "bg-green-600 hover:bg-green-700 text-white font-semibold"
                        : "border-green-600 text-green-400 hover:bg-green-600/20"
                    }
                  >
                    Use PR version
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      resolutions[conflict.path] === "base"
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      setResolutions({
                        ...resolutions,
                        [conflict.path]: "base",
                      })
                    }
                    className={
                      resolutions[conflict.path] === "base"
                        ? "bg-purple-600 hover:bg-purple-700 text-white font-semibold"
                        : "border-purple-600 text-purple-400 hover:bg-purple-600/20"
                    }
                  >
                    Use base version
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      resolutions[conflict.path] === "manual"
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      setResolutions({
                        ...resolutions,
                        [conflict.path]: "manual",
                      })
                    }
                    className={
                      resolutions[conflict.path] === "manual"
                        ? "bg-gray-600 hover:bg-gray-700 text-white font-semibold"
                        : "border-gray-600 text-gray-300 hover:bg-gray-600/20"
                    }
                  >
                    Manual edit
                  </Button>
                </div>
              </div>

              {resolutions[conflict.path] === "manual" && (
                <div className="mt-3">
                  <textarea
                    className="w-full border border-gray-600 bg-gray-800 text-white rounded p-2 font-mono text-sm h-32"
                    value={
                      manualResolutions[conflict.path] ||
                      conflict.prContent ||
                      ""
                    }
                    onChange={(e) =>
                      setManualResolutions({
                        ...manualResolutions,
                        [conflict.path]: e.target.value,
                      })
                    }
                    placeholder="Edit file content manually..."
                  />
                </div>
              )}

              {resolutions[conflict.path] &&
                resolutions[conflict.path] !== "manual" && (
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 mb-2">
                        PR Version
                      </h4>
                      <pre className="bg-gray-800 p-2 rounded text-xs overflow-auto max-h-32">
                        {conflict.prContent || "(deleted)"}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 mb-2">
                        Base Version
                      </h4>
                      <pre className="bg-gray-800 p-2 rounded text-xs overflow-auto max-h-32">
                        {conflict.baseContent || "(deleted)"}
                      </pre>
                    </div>
                  </div>
                )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleResolve}
            disabled={conflicts.some((c) => !resolutions[c.path])}
            className="bg-green-600 hover:bg-green-700"
          >
            <GitMerge className="mr-2 h-4 w-4" />
            Resolve conflicts and merge
          </Button>
        </div>
      </div>
    </div>
  );
}
