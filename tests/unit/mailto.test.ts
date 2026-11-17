import { describe, expect, it } from "vitest";
import { clipboardText, mailtoHref } from "../../lib/email/mailto";

describe("Outlook handoff", () => {
  const d = { subject: "TAPE check-in: Riverbend County", body: "Good morning,\n\nLine two & more.", to: ["director@riverbend.example.edu"], cc: ["admin@state.example.gov", "reviewer@state.example.gov"] };
  it("builds a mailto link with to, cc, subject, and body encoded", () => {
    const href = mailtoHref(d);
    expect(href.startsWith("mailto:director%40riverbend.example.edu?")).toBe(true);
    expect(href).toContain("cc=admin%40state.example.gov%2Creviewer%40state.example.gov");
    expect(href).toContain("subject=TAPE%20check-in%3A%20Riverbend%20County");
    expect(href).toContain("body=Good%20morning%2C%0A%0ALine%20two%20%26%20more.");
    expect(href).not.toContain("+");
  });
  it("truncates a very long body and says so", () => {
    const href = mailtoHref({ ...d, body: "x".repeat(5000) });
    expect(decodeURIComponent(href)).toContain("Message continues");
    expect(href.length).toBeLessThan(2600);
  });
  it("formats the clipboard copy with headers", () => {
    expect(clipboardText(d)).toBe("To: director@riverbend.example.edu\nCc: admin@state.example.gov; reviewer@state.example.gov\nSubject: TAPE check-in: Riverbend County\n\nGood morning,\n\nLine two & more.");
  });
});
