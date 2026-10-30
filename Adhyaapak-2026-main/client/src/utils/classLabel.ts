import type { ClassDto } from "@adhyaapak/shared";

/** A class's name, with its join code added when another class has the same name, so two "6A"s can be told apart. */
export const classLabel = (c: Pick<ClassDto, "id" | "name" | "joinCode">, all: ReadonlyArray<Pick<ClassDto, "id" | "name">>): string =>
  all.some((o) => o.id !== c.id && o.name === c.name) ? `${c.name} · ${c.joinCode}` : c.name;
