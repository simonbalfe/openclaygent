# Agent flow, stylised: "Find one customer case study" on lemlist.com

A real run (Claude Haiku 4.5, 2026-06-12), written out as the agent's working monologue.
The quoted thoughts are the model's actual inter-step text from the trace; tool calls and
results are verbatim. Total: 4 LLM rounds, 1 search, 2 fetches, ~11s, ~$0.003.

---

**Input.**

- System prompt (the action's `instructions`):

  > You are an expert web researcher. Find one strong customer case study published by the
  > target company on its own website. Locate the company's case studies / customers
  > section, pick a concrete story (a named customer), and extract: the customer's name,
  > the case study URL on the company's own domain, and the headline result or metric the
  > case study claims. Only report a case study you actually opened; do not invent
  > metrics. If none exists, return null fields.

- User prompt (template `{{slots}}` filled from the row `{ company: "Lemlist", domain: "lemlist.com" }`):

  > Company: Lemlist (website: lemlist.com). Find one customer case study they published.

---

**Round 1 — orient.**

> *"I'll search for Lemlist's customer case studies on their website."*

The instructions say the case study must be on the company's own domain, so it doesn't
search the open web — it scopes the query with a site filter straight away:

```
web_search("Lemlist customer case studies site:lemlist.com")
```

SearXNG returns 5 results. Two stand out: `lemlist.com/success-stories` ("Discover how
sales teams, agencies, and founders use lemlist...") and a teaser snippet about
ElevenLabs. A blog post about HubSpot integrations also appears — ignorable, it's an
article, not a customer story.

**Round 2 — navigate to the index, not a guess.**

> *"Great! I found that Lemlist has a success stories page. Let me fetch that page to
> find a specific customer case study."*

It doesn't gamble on a deep URL from a snippet; it reads the section index first:

```
fetch_page(["https://www.lemlist.com/success-stories"])
```

The tool returns ~1k chars of clean markdown (impit fetch, pruned, Turndown). The page is
a menu of stories, each with a metric and a same-domain link:

```
190 Meetings booked in one semester — Pennylane
  [Discover full story](https://www.lemlist.com/success-stories/pennylane)
2x Outbound meetings per AE — Spendesk
  [Discover full story](https://www.lemlist.com/success-stories/spendesk)
6x Outbound success — ElevenLabs ...
2x Open rate — Mindee ...
10x More meetings booked — RightMarket ...
```

**Round 3 — pick one and verify by opening it.**

> *"Perfect! I found several case studies. Let me fetch one of them to get the full
> details. I'll choose the Pennylane case study."*

"Find **one** strong story" — Pennylane is the first listed, has a named customer and a
concrete metric, and its link was right there in the page text. The instruction "only
report a case study you actually opened" means a teaser isn't enough, so:

```
fetch_page(["https://www.lemlist.com/success-stories/pennylane"])
```

Back comes the full 6k-char case study: the 190-meetings headline, 70% inbound
conversion, 15+ meetings per AE at their key industry event, quotes from the BDR lead,
the company fact box.

**Round 4 — enough; answer.**

No tool call this time — the model writes its findings as prose (customer, URL, the
metrics it just read). Emitting text instead of a tool call is what ends the loop.

---

**Structuring pass.** A second LLM call forces that prose into the action's Zod schema:

```json
{
  "customer": "Pennylane",
  "case_study_url": "https://www.lemlist.com/success-stories/pennylane",
  "headline_result": "190 meetings booked in one semester with a team of 3 BDR ICs, achieving 70% conversion rate of inbound leads and 15+ meetings per AE at key industry events"
}
```

`RunResult` also carries the provenance: 8 source URLs, the
`search → fetch → fetch → answer` step log, 7.5k/423 tokens.

---

**Why this run is the pattern working as designed:**

- **Site-scoped first query** — the schema/instructions steer the very first search.
- **Index before deep link** — it navigates like a person: section page, then the story.
- **Same-domain links in fetched markdown** are what made round 3's URL knowable without
  guessing (the extractor keeps on-domain hrefs, flattens off-domain ones).
- **"Only report what you opened" was obeyed** — it fetched the story before claiming its
  metrics, and the metrics in the answer all appear in the fetched text.
- **Cheapest path throughout** — SearXNG + impit, zero paid fetch/search calls; the only
  cost was the LLM. A different run picked ElevenLabs instead — "find one" is
  legitimately nondeterministic across runs.
