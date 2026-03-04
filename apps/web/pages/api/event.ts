import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    console.log("event", req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "fail" });
  }
}
