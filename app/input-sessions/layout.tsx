import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TAPE Input Sessions | Alabama CTE",
  description: "Capture small-group TAPE redesign input from each team and combine it into one report.",
};

export default function InputSessionsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
