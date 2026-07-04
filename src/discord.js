export async function postEmbed(channelId, embed, { token, fetchImpl = fetch }) {
  const send = () =>
    fetchImpl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "6deux6 (https://github.com/estevanhernandez-stack-ed/6deux6, 0.1)",
      },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(15000),
    });

  let res = await send();
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const waitMs = Math.ceil((body.retry_after ?? 1) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));
    res = await send();
  }
  if (!res.ok) {
    throw new Error(`Discord POST failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}
