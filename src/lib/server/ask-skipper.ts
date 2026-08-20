import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const askSkipper = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ prompt: z.string().min(8).max(1200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Skipper AI is not available in this environment" };
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              "You are Ahanu, a joyful, professional canyon-fishing skipper's mate for Rhode Island / Northeast US offshore anglers. Be specific, calm, and useful. No emoji. Not legal advice. Not a substitute for official charts or lookout.",
          },
          { role: "user", content: data.prompt },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: `xAI API error ${res.status}` };
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    return { ok: true as const, text: body.choices[0]?.message.content ?? "" };
  });
