/**
 * Pictures sent along with a message. They are placed in the user message
 * for the model to look at, and left out of the saved session so the
 * session file stays small.
 */
import type { ModelMessage } from "ai";
import type { ImageInput } from "../../core/mode";
import type { AgentSession } from "./types";

const IMAGE_PLACEHOLDER = "[an image was attached here]";

/**
 * The user message for this input. Pictures waiting on the session are
 * added once: later inputs of the same turn (check results) are text only.
 */
export function takeUserMessage(session: AgentSession, text: string): ModelMessage {
    const images: ImageInput[] = session.pendingImages ?? [];
    session.pendingImages = undefined;
    if (!images.length) return { role: "user", content: text };
    return {
        role: "user",
        content: [
            { type: "text", text },
            ...images.map((image) => ({
                type: "image" as const,
                image: Buffer.from(image.data).toString("base64"),
                mediaType: image.mediaType,
            })),
        ],
    };
}

/** A copy of the messages with every picture replaced by a short note. */
export function withoutImages(messages: ModelMessage[]): ModelMessage[] {
    return messages.map((message): ModelMessage => {
        if (message.role !== "user" || typeof message.content === "string") return message;
        return {
            ...message,
            content: message.content.map((part) =>
                part.type === "image" ? { type: "text" as const, text: IMAGE_PLACEHOLDER } : part,
            ),
        };
    });
}
