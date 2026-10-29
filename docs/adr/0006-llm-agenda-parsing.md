# 6. Parse pasted agendas with Claude on Bedrock, outside the VPC

- Status: accepted
- Date: 2026-10-27
- Lab: 6, "Paste it, check it, save it"

## Context

Agendas reach team leads as emails, chat messages and notes, not as forms. Retyping them into the
Add agenda form is slow, so people skip the agenda. **Paste an agenda** takes that text, has an LLM
turn it into a structured agenda, and shows the normal agenda form pre-filled. The user checks it
and presses Save.

Constraints:

- **No NAT.** The ECS tasks and the lab 5 report builder sit in subnets with no route to the
  internet. A NAT gateway (~$32/month) or a Bedrock interface endpoint (~$7.30/month) would break
  "nothing costs money while nobody uses it".
- **Every call costs money.** One parse costs from a fraction of a cent (Haiku) to about two cents
  (Opus). An open endpoint is an open wallet.
- **The text comes from outside.** People paste emails written by somebody else, so the text can
  contain instructions aimed at the model (prompt injection).
- **The model can be wrong with a 200.** It may invent an owner or a date that is not in the text.

## Decision

1. **Model:** Kimi K2.5 (`moonshotai.kimi-k2.5`) on Amazon Bedrock (`bedrock-mantle`,
   us-east-1), through mantle's OpenAI-compatible chat completions signed with the function's
   IAM role. The lab names Claude Opus 5.5, but this account's Bedrock quotas for every Claude
   model are 0 (AWS Support case 179328966400503). With the lecturer's permission we picked the
   model that did best on the step 5 inputs: Kimi K2.5 beat Qwen3 235B, GLM-5, Mistral Large 3,
   DeepSeek V3.2 and gpt-oss-120b on accuracy and latency. The code keeps the Claude path
   (Anthropic Messages API, `effort: low`) for any `anthropic.*` model. The model is
   configuration (`PARSER_MODEL`), so Claude is one variable away once the quotas allow it.
2. **A structured contract:** the model must answer by calling one tool, `record_agenda`, whose
   input schema is the Pydantic model `ParsedAgenda`. The answer is validated. An invalid answer
   goes back to the model once with the validation error, and a second failure becomes a clear
   error. Today's date and the user's time zone are part of the prompt. The pasted text is
   wrapped in `<pasted_text>`, and the system prompt calls it data. Empty fields stay empty.
3. **The parser runs outside the VPC,** as its own Lambda function (`infra/ai.yml`, the backend's
   image with the handler `app.ai.agenda_lambda.handler`) behind a function URL. It needs no
   database: text in, JSON out. Outside the VPC it reaches Bedrock over the internet with no NAT
   and no endpoint, and it costs nothing when idle.
4. **The model never writes.** The parser only returns a suggestion. The save goes from the
   browser to the existing API (`POST /api/meetings/{id}/agenda`) with its usual validation. The
   API stores the suggestion, model and prompt version next to the saved agenda
   (`agendas.ai_suggestion`). The difference between the two is the quality signal.
5. **Only signed-in users can parse.** The handler checks the lab 4 Cognito access token against
   the pool's JWKS and answers 401 otherwise. Text over 10,000 characters gets 413 before the
   model is called. The function's role may only call `bedrock-mantle:CreateInference`.

## Alternatives considered

| Alternative | Why it lost |
|---|---|
| Call Bedrock from the API (ECS, in the VPC) through a `bedrock-mantle` interface endpoint | ~$7.30/month per endpoint (per AZ), even with no traffic. A slow model call would also hold an API worker for up to 30 s. The parse needs nothing the API has. |
| The Claude API directly (api.anthropic.com) instead of Bedrock | It needs an API key stored as a secret, and its bill sits outside AWS Budgets and tags. The function would also need egress rules for a third-party host. Bedrock authorizes with the function's IAM role: there is no key that could leak. |
| A regular-expression parser | It is free, fast and predictable, but only for one format. Real input mixes Ukrainian and English, numbered lists and prose, "Олена, 15 хв" and "Olena (15 min)", and relative dates. Every new format would need a new rule, and it would fail silently. |
| Let the model save the agenda itself (a `save_agenda` tool) | Text from a stranger could make it write. Writes must go through the validated endpoint, after a person has looked at them. |

## Consequences

- **Cost per parse,** measured on the five step 5 inputs: 400–1,250 input tokens and 20–370
  output tokens. That averages $0.00075 on Kimi K2.5 ($0.60 / $3.00 per million tokens) and
  $0.00031 on Qwen3 235B. At 20 organisations × 30 parses a week (~2,600 a month) this comes to
  about $2/month on Kimi, against an estimated ~$50 on Claude Opus 5.5. The interface endpoint we
  avoided would cost $7.30/month per AZ even at zero parses.
- **Accuracy:** on the five inputs Kimi K2.5 invented one value: 13:00 from "after lunch". It
  ignored the injection. Weekday arithmetic is the weak spot: Qwen put "next Tuesday" on a
  Wednesday, and Kimi once picked last Monday. The planned agenda-v2 fixes this by giving the
  prompt a 14-day date → weekday table, letting the code apply the UTC offset from `tz`, and
  allowing a date without a time.
- **Logged on every parse:** one JSON line with the user (Cognito `sub`), model, prompt version,
  input and output tokens, latency and estimated cost. The pasted text itself is not logged.
- **When Bedrock is down or throttling,** the screen says so (429 → "busy", 5xx → "not
  available") and the user types the agenda by hand. Everything else in Spry keeps working,
  because the parser is not on the path of any other feature.
- **Guardrails we rely on:** the AWS Budgets alarm at $5/month, the 10,000-character limit and
  sign-in. There is no per-user rate limit yet; that is the next thing to add if accounts are
  abused.
- The prompt is versioned (`agenda-v1`). Changing it means bumping the version, so stored
  suggestions can be compared between versions.
