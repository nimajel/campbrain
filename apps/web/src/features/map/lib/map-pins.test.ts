import { describe, it, expect } from "vitest";
import {
  getParkType, buildPinHtml, buildClusterHtml, buildLegendSwatchHtml,
  formatCount, PIN_LEGEND, GLYPHS, CLUSTER_SIZE,
} from "./map-pins";

describe("getParkType", () => {
  it("maps california-parks to state", () => {
    expect(getParkType("california-parks")).toBe("state");
  });
  it("maps anything else to federal", () => {
    expect(getParkType("recreation-gov")).toBe("federal");
  });
});

describe("formatCount", () => {
  it("caps at 99+", () => {
    expect(formatCount(150)).toBe("99+");
    expect(formatCount(7)).toBe("7");
  });
});

describe("buildPinHtml", () => {
  it("includes the availability class", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 3 });
    expect(html).toContain("cb-pin--match");
  });
  it("renders a count badge for match with a count", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 3 });
    expect(html).toContain(">3<");
  });
  it("omits the badge for the 'none' state", () => {
    const html = buildPinHtml({ parkType: "state", availability: "none", count: 0 });
    expect(html).not.toContain("cb-badge");
  });
  it("draws the selection ring when selected", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 1, selected: true });
    expect(html).toContain("stroke-width=\"4\"");
  });
  it("uses the state glyph path for a state park", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 1 });
    expect(html).toContain(GLYPHS.state);
  });
  it("escapes the aria-label", () => {
    const html = buildPinHtml({ parkType: "state", availability: "match", count: 1, label: "A & B \"park\"" });
    expect(html).toContain("aria-label=\"A &amp; B &quot;park&quot;\"");
  });
});

describe("buildClusterHtml", () => {
  it("sizes the icon container to CLUSTER_SIZE", () => {
    const html = buildClusterHtml(10, 4);
    expect(html).toContain(`width:${CLUSTER_SIZE}px`);
    expect(html).toContain(">10<");
  });
  it("marks the cluster as none when no matches", () => {
    expect(buildClusterHtml(10, 0)).toContain("cb-cluster--none");
  });
  it("draws a full ring when all match", () => {
    const html = buildClusterHtml(5, 5);
    expect(html).not.toContain("stroke-dasharray");
  });
  it("draws a partial arc when some match", () => {
    expect(buildClusterHtml(10, 3)).toContain("stroke-dasharray");
  });
});

describe("PIN_LEGEND + swatch", () => {
  it("flags pin-none as only-when-filtered", () => {
    const none = PIN_LEGEND.find((e) => e.kind === "pin-none");
    expect(none?.onlyWhenFiltered).toBe(true);
  });
  it("builds a glyph swatch for state", () => {
    expect(buildLegendSwatchHtml("glyph-state")).toContain(GLYPHS.state);
  });
});
