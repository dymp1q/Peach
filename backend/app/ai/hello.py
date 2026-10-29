"""The first call to the model on Bedrock (lab 6, step 1): make llm-hello."""

from app.ai.agenda import _bedrock, _mantle_chat
from app.config import get_settings

QUESTION = "In one sentence: what is an ISO week?"


def main() -> None:
    model = get_settings().parser_model
    if model.startswith("anthropic."):
        msg = _bedrock().messages.create(
            model=model,
            max_tokens=1024,
            output_config={"effort": "low"},  # short, cheap answers
            messages=[{"role": "user", "content": QUESTION}],
        )
        print(next(b.text for b in msg.content if b.type == "text"))
        print(msg.stop_reason, msg.usage.input_tokens, msg.usage.output_tokens)
        return
    answer = _mantle_chat(
        {"model": model, "max_tokens": 1024, "messages": [{"role": "user", "content": QUESTION}]}
    )
    choice = answer["choices"][0]
    print(choice["message"]["content"])
    usage = answer["usage"]
    print(choice["finish_reason"], usage["prompt_tokens"], usage["completion_tokens"])


if __name__ == "__main__":
    main()
