import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgendaForm } from "@/components/agenda-form";

const suggestion = {
  agenda: {
    title: null,
    starts_at: null,
    duration_minutes: null,
    items: [
      { topic: "Нові тарифи Pro", owner: "Олена", minutes: 15 },
      { topic: "Фідбек від клієнтів", owner: "Taras", minutes: null },
    ],
    action_items: [
      { task: "Порівняння з конкурентами", owner: "Taras", due: "2026-10-30" },
    ],
    language: "uk",
  },
  model: "anthropic.claude-opus-5-5",
  prompt_version: "agenda-v1",
};

const seed = {
  items: suggestion.agenda.items,
  action_items: suggestion.agenda.action_items,
  suggestion,
};

describe("AgendaForm", () => {
  it("marks only the fields the model filled", () => {
    render(<AgendaForm seed={seed} onSave={vi.fn()} />);
    // 2 + 2 + 1 items' fields, 3 action fields; the empty minutes stays plain.
    expect(screen.getAllByTestId("suggested")).toHaveLength(8);
    expect(screen.getByLabelText("Minutes for topic 2")).toHaveValue(null);
  });

  it("drops the badge once the user edits a field", () => {
    render(<AgendaForm seed={seed} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Owner of topic 1"), {
      target: { value: "Olena K." },
    });
    expect(screen.getAllByTestId("suggested")).toHaveLength(7);
  });

  it("saves the corrected agenda with the suggestion next to it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AgendaForm seed={seed} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Minutes for topic 2"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save agenda/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0];
    expect(saved.items[1]).toEqual({
      topic: "Фідбек від клієнтів",
      owner: "Taras",
      minutes: 10,
    });
    expect(saved.ai_suggestion).toEqual(suggestion.agenda);
    expect(saved.ai_model).toBe("anthropic.claude-opus-5-5");
    expect(saved.ai_prompt_version).toBe("agenda-v1");
  });

  it("a hand-typed agenda carries no suggestion", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AgendaForm
        seed={{ items: [], action_items: [], suggestion: null }}
        onSave={onSave}
      />,
    );
    expect(screen.queryByTestId("suggested")).toBeNull();
    fireEvent.change(screen.getByLabelText("Topic 1"), {
      target: { value: "Retro" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save agenda/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({
      items: [{ topic: "Retro", owner: null, minutes: null }],
      action_items: [],
    });
  });

  it("needs at least one topic", async () => {
    const onSave = vi.fn();
    render(
      <AgendaForm
        seed={{ items: [], action_items: [], suggestion: null }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save agenda/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at least one topic",
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
