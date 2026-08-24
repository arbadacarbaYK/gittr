import { describe, expect, it } from "vitest";

import {
  APP_DIALOG_OVERLAY_CLASS,
  APP_DIALOG_PANEL_CLASS,
  escapeAppDialogText,
} from "./app-dialog";

describe("escapeAppDialogText", () => {
  it("escapes HTML so dialog copy cannot inject markup", () => {
    expect(escapeAppDialogText(`<b>hi</b> & "x"`)).toBe(
      "&lt;b&gt;hi&lt;/b&gt; &amp; &quot;x&quot;"
    );
  });
});

describe("app dialog sizing", () => {
  it("lets the overlay scroll the page, not a clipped panel", () => {
    expect(APP_DIALOG_OVERLAY_CLASS).toContain("overflow-y-auto");
    expect(APP_DIALOG_PANEL_CLASS).not.toMatch(/max-h-/);
    expect(APP_DIALOG_PANEL_CLASS).not.toMatch(/overflow-y-/);
  });
});
