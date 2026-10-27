"""The first call to Claude on Bedrock (lab 6, step 1): make llm-hello."""

from app.ai.agenda import _bedrock
from app.config import get_settings


def main() -> None:
    msg = _bedrock().messages.create(
        model=get_settings().parser_model,
        max_tokens=1024,
        output_config={"effort": "low"},  # short, cheap answers
        messages=[{"role": "user", "content": "In one sentence: what is an ISO week?"}],
    )
    print(next(b.text for b in msg.content if b.type == "text"))
    print(msg.stop_reason, msg.usage.input_tokens, msg.usage.output_tokens)


if __name__ == "__main__":
    main()
