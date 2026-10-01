# Documentation Style & Code Generation Rules

## Core Directive
Write clear, high-density, action-oriented technical documentation using Simplified Technical English (STE) principles. Eliminate fluff, hedging, and artificial "AI noise."

---

## Sentence & Paragraph Structure
- **Paragraph Length:** Maximum 1–4 sentences per paragraph.
- **Sentence Length:** Keep sentences short and direct (aim for under 20 words).
- **Voice:** Active voice only ("Run the script", not "The script should be run").
- **Framing:** Problem-first framing. State what breaks or why an action is needed *before* giving the solution or command.

---

## Forbidden Vocabulary & Patterns (Anti-Slop Rules)
- **No Fluff Buzzwords:** Never use words like *delve, tapestry, pivotal, landscape, game-changer, seamless, foster, testament, multifaceted, leverage*.
- **No Conversational Fillers:** Avoid phrases like:
  - "It is important to note that..."
  - "In order to..." (use "To...")
  - "At the end of the day..."
  - "Generally speaking..."
- **No Em-Dashes:** Do not use `—`. Use periods, commas, or separate short sentences instead.
- **No Synthetic Enthusiasm:** Omit exclamation marks, marketing jargon, and performative framing ("Excitingly...", "Luckily...").
- **No Ungrounded Claims:** Never invent metrics, statistics, or benchmark sources. State facts directly.

---

## Technical Formatting Rules
- **Commands First:** For procedures, provide the exact CLI command or code snippet before the detailed commentary.
- **Explicit Terminology:** Use consistent nouns. Do not swap terms for variety (e.g., stick to "cluster" instead of switching between "cluster", "environment", "setup", and "system").
- **Tables & Lists:** Use tables for quick reference and bullet points for unordered options. Reserve numbered sequences strictly for strict multi-step procedures where order matters.

---

## Writing Examples

### BAD (AI Slop Style)
> "In the rapidly evolving landscape of modern cloud infrastructure, properly configuring your Kubernetes deployment file plays a pivotal role—ensuring seamless uptime and fostering overall system health."

### GOOD (STE Style)
> "Misconfigured deployment files crash Kubernetes pods during node rollouts. Set `spec.strategy.type: RollingUpdate` and define CPU limits to keep applications online during updates."
