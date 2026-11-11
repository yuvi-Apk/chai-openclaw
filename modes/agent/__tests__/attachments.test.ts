import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { takeUserMessage, withoutImages } from "../attachments";
import type { AgentSession } from "../types";

const sessionWith = (pendingImages?: AgentSession["pendingImages"]) => ({ pendingImages }) as AgentSession;

describe("pictures sent with a message", () => {
    test("without pictures the user message is plain text", () => {
        expect(takeUserMessage(sessionWith(), "hello")).toEqual({ role: "user", content: "hello" });
    });

    test("pictures are attached once, to the first message of the turn", () => {
        const session = sessionWith([{ mediaType: "image/jpeg", data: new Uint8Array([104, 105]) }]);
        expect(takeUserMessage(session, "what is this?")).toEqual({
            role: "user",
            content: [
                { type: "text", text: "what is this?" },
                { type: "image", image: "aGk=", mediaType: "image/jpeg" },
            ],
        });
        expect(session.pendingImages).toBeUndefined();
        expect(takeUserMessage(session, "[harness] checks passed")).toEqual({ role: "user", content: "[harness] checks passed" });
    });

    test("the saved session keeps the words and drops the picture data", () => {
        const messages: ModelMessage[] = [
            { role: "user", content: [{ type: "text", text: "look" }, { type: "image", image: "aGk=", mediaType: "image/jpeg" }] },
            { role: "assistant", content: "I see it." },
            { role: "user", content: "thanks" },
        ];
        const saved = withoutImages(messages);
        expect(JSON.stringify(saved)).not.toContain("aGk=");
        expect(saved[0]).toEqual({ role: "user", content: [{ type: "text", text: "look" }, { type: "text", text: "[an image was attached here]" }] });
        expect(saved.slice(1)).toEqual(messages.slice(1));
    });
});
