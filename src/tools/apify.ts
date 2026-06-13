const APIFY = "https://api.apify.com/v2";

interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
}

export async function runActor<T>(actor: string, input: unknown): Promise<{ items: T[]; usd: number }> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN is not set");
  const start = await fetch(`${APIFY}/acts/${actor}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!start.ok) throw new Error(`Apify ${actor} ${start.status}: ${(await start.text()).slice(0, 300)}`);
  let run = ((await start.json()) as { data: ApifyRun }).data;

  const deadline = Date.now() + 150_000;
  while (run.status === "READY" || run.status === "RUNNING") {
    if (Date.now() > deadline) throw new Error(`Apify ${actor} timed out (run ${run.id})`);
    const poll = await fetch(`${APIFY}/actor-runs/${run.id}?token=${token}&waitForFinish=30`);
    if (!poll.ok) throw new Error(`Apify ${actor} poll ${poll.status}: ${(await poll.text()).slice(0, 300)}`);
    run = ((await poll.json()) as { data: ApifyRun }).data;
  }

  const itemsRes = await fetch(`${APIFY}/datasets/${run.defaultDatasetId}/items?token=${token}`);
  if (!itemsRes.ok) throw new Error(`Apify ${actor} items ${itemsRes.status}`);
  return { items: (await itemsRes.json()) as T[], usd: run.usageTotalUsd ?? 0 };
}
