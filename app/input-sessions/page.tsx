"use client";

import dynamic from "next/dynamic";

const SessionsApp = dynamic(() => import("./SessionsApp"), {
  ssr: false,
  loading: () => <p style={{ padding: "40px 5vw", color: "#617087" }}>Loading input sessions…</p>,
});

export default function InputSessionsPage() {
  return <SessionsApp />;
}
