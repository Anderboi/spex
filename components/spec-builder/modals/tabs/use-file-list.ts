"use client";

import { useCallback, useOptimistic, useState, useTransition } from "react";

import {
  applyChangedFile,
  applyDeletedFile,
  applyUploadedFile,
} from "@/lib/spec/file-view";
import type { SpecItemFileCategory } from "@/lib/spec/file-content";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Список документов позиции с оптимистичными правками.
 *
 * ── Почему отдельный модуль ───────────────────────────────────────────────
 *
 * Список файлов держат ДВЕ вкладки: «Файлы» (все документы) и «Платежи»
 * (документы каждой оплаты — из того же списка). Оптимистичное состояние
 * обязано быть у обоих, иначе одна вкладка показывала бы удаление мгновенно, а
 * другая ждала бы сервер. Здесь это правило живёт один раз, и обе вкладки
 * получают его вместе со списком.
 *
 * ── Почему `useOptimistic`, а не своё состояние ───────────────────────────
 *
 * Ровно тот же приём, что в `materials-client.tsx` и `contacts-list.tsx`: список
 * рисуется из оптимистичного состояния, а применение и откат делает React.
 * Своё «временное» состояние пришлось бы откатывать вручную в каждом `catch`, и
 * одна забытая ветка оставила бы строку удалённой навсегда.
 *
 * ── Что оптимистично, а что нет ───────────────────────────────────────────
 *
 * Оптимистично то, что пользователь УЖЕ решил: удалить файл, сменить вид,
 * переименовать. Во всех трёх случаях клиент знает точный результат — ввод
 * пользователя, — и он же видит его сразу. Отказ сервера возвращает строку и
 * показывает текст отказа: `useOptimistic` откатывает сам, потому что
 * оптимистичное состояние живёт только внутри перехода.
 *
 * НЕ оптимистична загрузка. Строка «Загружается» — это очередь отправки, и она
 * уже показывает, что работа идёт. Дорисовывать вместо неё готовый файл значило
 * бы утверждать, что он на сервере, — а он может не дойти (размер, тип, права),
 * и тогда пользователь увидел бы файл, которого нет, а затем его исчезновение.
 *
 * ── Почему мутации идут через `startTransition` ───────────────────────────
 *
 * Оптимистичное состояние React держит только внутри перехода (transition).
 * Поэтому каждая правка обёрнута в `startTransition`: без этого состояние
 * откатывалось бы сразу после первого кадра, и строка «возвращалась» бы на
 * время запроса — то есть оптимистичность превращалась бы в мигание.
 */
export type FileListAction =
  /** Заменить весь список: так приходит ответ чтения. */
  | { type: "replace"; files: SpecItemFileEntry[] }
  | { type: "uploaded"; entry: SpecItemFileEntry }
  | { type: "changed"; entry: SpecItemFileEntry }
  | { type: "deleted"; fileId: string }
  /** Мгновенная правка до ответа сервера: вид документа. */
  | { type: "category"; fileId: string; category: SpecItemFileCategory }
  /** Мгновенная правка до ответа сервера: имя файла. */
  | { type: "name"; fileId: string; fileName: string }
  /**
   * Сбросить оптимистичную правку.
   *
   * Нужно на отказ сервера: текст отказа показывается, а строка обязана
   * вернуться к тому, что лежит в БД, — иначе интерфейс показывал бы правку,
   * которой нет.
   */
  | { type: "undo" };

/**
 * Чистое правило списка: что показать после действия.
 *
 * Экспортируется отдельно от хука, потому что это правило проверяется тестами и
 * повторяется там, где список обновляют вручную (например, в тестовой обёртке).
 * Двух копий «как меняется список» быть не должно: разойдись они — и оптимистичный
 * показ в тестах перестал бы совпадать с настоящим.
 */
export function applyFileListAction(
  state: SpecItemFileEntry[],
  action: FileListAction,
): SpecItemFileEntry[] {
  switch (action.type) {
    case "replace":
      return action.files;
    case "uploaded":
      return applyUploadedFile(state, action.entry);
    case "changed":
      return applyChangedFile(state, action.entry);
    case "deleted":
      return applyDeletedFile(state, action.fileId);
    case "category":
      return state.map((file) =>
        file.id === action.fileId ? { ...file, category: action.category } : file,
      );
    case "name":
      return state.map((file) =>
        file.id === action.fileId ? { ...file, fileName: action.fileName } : file,
      );
    case "undo":
      // Возврат делает сам React: оптимистичное состояние сбрасывается, и
      // списком снова становится то, что пришло из БД.
      return state;
  }
}

export type FileList = {
  /** Что рисует список: оптимистичное состояние поверх данных из БД. */
  files: SpecItemFileEntry[];
  /**
   * Выполнить мутацию с оптимистичным показом результата.
   *
   * `optimistic` — что показать сразу (отказ сервера откатывает это сам);
   * `run` — сама операция, обычно server action. Результат возвращается как
   * есть, чтобы вызывающий сам решил, как показать отказ.
   */
  mutate: <T>(
    optimistic: FileListAction | FileListAction[],
    run: () => Promise<T>,
  ) => Promise<T>;
  /** Записать в список ответ сервера (без оптимистичного состояния). */
  apply: (action: FileListAction) => void;
};

export function useFileList(
  stored: SpecItemFileEntry[],
  onStoredChange: (
    updater: (current: SpecItemFileEntry[]) => SpecItemFileEntry[],
  ) => void,
): FileList {
  const [optimistic, setOptimistic] = useOptimistic(stored, applyFileListAction);
  const [, startTransition] = useTransition();

  /**
   * Оптимистичный показ и запуск операции в ОДНОМ переходе.
   *
   * `startTransition` с асинхронным колбэком: React держит оптимистичное
   * состояние до завершения обещания и откатывает его, если операция бросила
   * исключение. Внутри колбэка `setOptimistic` вызывается ДО первого `await` —
   * этого требует React, иначе оптимистичное состояние не успевает встать.
   */
  const mutate = useCallback(
    <T,>(
      optimisticAction: FileListAction | FileListAction[],
      run: () => Promise<T>,
    ): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        startTransition(async () => {
          const actions = Array.isArray(optimisticAction)
            ? optimisticAction
            : [optimisticAction];
          for (const action of actions) setOptimistic(action);

          try {
            resolve(await run());
          } catch (cause) {
            // Исключение не глотается: вызывающий покажет отказ, а оптимистичное
            // состояние React откатит сам.
            reject(cause);
          }
        });
      }),
    [setOptimistic],
  );

  const apply = useCallback(
    (action: FileListAction) => {
      onStoredChange((current) => applyFileListAction(current, action));
    },
    [onStoredChange],
  );

  return { files: optimistic, mutate, apply };
}

/**
 * Список файлов, которым владеет вкладка: данные из БД плюс оптимистичные правки.
 *
 * Обёртка над `useFileList` для двух вкладок: они держат одинаковое состояние и
 * одинаково обновляют его ответами сервера, поэтому владение списком тоже
 * вынесено сюда, а не написано дважды.
 */
export function useStoredFileList(initial: SpecItemFileEntry[] = []) {
  const [stored, setStored] = useState<SpecItemFileEntry[]>(initial);
  const list = useFileList(stored, setStored);

  return { stored, setStored, ...list };
}
