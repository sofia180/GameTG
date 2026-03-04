"use client";

export async function track(event: string, props?: Record<string, unknown>) {
  try {
    await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, props, ts: Date.now() })
    });
  } catch (err) {
    console.warn("track failed", err);
  }
}
