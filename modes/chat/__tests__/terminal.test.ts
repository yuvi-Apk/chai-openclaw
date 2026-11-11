import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AnswerPrinter } from "../terminal";

/** Collects what the printer writes, with colour codes removed. */
let written: string[] = [];
const realWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
    written = [];
    process.stdout.write = ((chunk: string) => {
        written.push(String(chunk).replace(/\x1b\[[0-9;]*m/g, ""));
        return true;
    }) as typeof process.stdout.write;
});
afterEach(() => {
    process.stdout.write = realWrite;
});

/** Feed text in small pieces, as a model stream would. */
function stream(printer: AnswerPrinter, text: string): void {
    for (const piece of text.match(/.{1,3}/gs) ?? []) printer.push(piece);
}

describe("answer printer", () => {
    test("prints each paragraph as soon as it is complete", () => {
        let started = 0;
        const printer = new AnswerPrinter(() => started++);
        stream(printer, "First paragraph.\n\nSecond paragraph.\n\nThird");
        expect(written).toHaveLength(2);
        expect(written[0]).toContain("First paragraph.");
        printer.end();
        expect(written).toHaveLength(3);
        expect(started).toBe(1);
    });

    test("keeps a spaced-out list in one block", () => {
        const printer = new AnswerPrinter(() => undefined);
        stream(printer, "Steps:\n\n1. one\n\n2. two\n\n3. three\n\nDone.");
        printer.end();
        const list = written.find((w) => w.includes("one"))!;
        expect(list).toContain("two");
        expect(list).toContain("three");
    });

    test("never splits a code block at a blank line", () => {
        const printer = new AnswerPrinter(() => undefined);
        stream(printer, "Code:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.");
        printer.end();
        const code = written.find((w) => w.includes("const a"))!;
        expect(code).toContain("const b");
    });

    test("prints nothing for an empty answer", () => {
        const printer = new AnswerPrinter(() => undefined);
        printer.end();
        expect(written).toHaveLength(0);
    });
});
