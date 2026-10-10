"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { uploadSpecItemFile } from "@/actions/spec-item-files";
import {
  MAX_SPEC_ITEM_FILE_BYTES,
  MAX_SPEC_ITEM_FILE_LABEL,
} from "@/lib/spec/file-content";
import { FILE_CATEGORY_OPTIONS, formatFileSize } from "@/lib/spec/file-view";
import type { SpecItemFileCategory } from "@/lib/spec/file-content";
import type { SpecItemFileEntry } from "@/lib/spec/spec-item-files";

/**
 * Диалог загрузки файла: выбранный файл, выбор категории и отправка.
 *
 * ── Почему диалог, а не сразу upload ───────────────────────────────────────
 *
 * Категория (`document | texture | other`) обязательна для server action, но из
 * имени файла её не вывести. Поэтому выбор разделён на два шага: picker даёт
 * файл, диалог — категорию и подтверждение. До нажатия «Загрузить» на сервер не
 * уходит ничего.
 *
 * ── Что проверяется на клиенте, а что нет ──────────────────────────────────
 *
 * Клиент проверяет только UX-вещи: файл есть и его размер не больше лимита
 * сервера (`MAX_SPEC_ITEM_FILE_BYTES`, те же 25 МиБ, что в `file_size_limit`
 * bucket'а). MIME, сигнатуру содержимого и права проверяет сервер — повторять
 * это здесь значило бы завести вторую, расходящуюся валидацию. Поэтому любая
 * серверная ошибка (тип, подделка содержимого, права) показывается как есть,
 * текстом из ответа.
 *
 * ── Состояния ──────────────────────────────────────────────────────────────
 *
 * `idle` → `uploading` → (`success` | `error`). Своего «прогресса» нет и быть не
 * может: server action не отдаёт прогресс, а рисовать выдуманные проценты —
 * обман. Пока идёт загрузка, показывается `Attachment state="uploading"` и
 * спиннер, кнопки выключены.
 *
 * ── Отмена ─────────────────────────────────────────────────────────────────
 *
 * Отменить можно только выбор: пока `idle`, доступны «Отмена» и крестик. После
 * начала загрузки отмены нет — server action не принимает `AbortSignal`, и
 * «отмена» на клиенте не остановила бы ни запрос, ни запись в Storage.
 *
 * ── Защита от гонки ────────────────────────────────────────────────────────
 *
 * Свой счётчик попыток (`requestRef`), не общий с `FilesTab`: операции
 * независимы, и общий счётчик заставлял бы их гасить друг друга. Ответ
 * устаревшей попытки (повторная отправка, смена позиции, закрытие диалога) не
 * попадает ни в состояние диалога, ни в список.
 */

/**
 * Варианты категории берутся из общей таблицы подписей (`FILE_CATEGORY_OPTIONS`):
 * тот же список показывает категорию в списке файлов. Своей копии подписей здесь
 * нет намеренно — иначе «Текстура» в диалоге и в строке могли бы разойтись.
 */
const CATEGORY_OPTIONS = FILE_CATEGORY_OPTIONS;

/** Категория по умолчанию — как в контракте сервера. */
const DEFAULT_CATEGORY: SpecItemFileCategory = "document";

export default function FileUploadDialog({
  open,
  file,
  orgSlug,
  specItemId,
  paymentId = null,
  onClose,
  onUploaded,
}: {
  open: boolean;
  /** Выбранный файл; `null` — нечего загружать (диалог тогда не открывается). */
  file: File | null;
  orgSlug: string;
  specItemId: string;
  /**
   * Оплата, к которой прикрепляется документ. `null` — обычный файл позиции.
   *
   * Диалог один на оба случая намеренно: и «добавить файл к позиции», и
   * «прикрепить чек к оплате» — это одна операция с одним набором проверок
   * (размер, вид документа, права), и отличается она ровно одним полем формы.
   * Второй диалог разошёлся бы с первым в первой же правке валидации.
   */
  paymentId?: string | null;
  /** Закрыть диалог: отмена, крестик, успешная загрузка. */
  onClose: () => void;
  /**
   * Загрузка удалась: наружу уходит запись, которую вернул сервер, ВМЕСТЕ с
   * позицией, для которой она создана.
   *
   * Позиция передаётся не для красоты: пока запрос шёл, `specItemId` мог
   * смениться, и тогда запись относится к прошлой позиции. Список сверяет
   * ключ со своим текущим и устаревший ответ игнорирует — независимо от того,
   * успел ли уже отработать cleanup эффекта.
   */
  onUploaded: (entry: SpecItemFileEntry, forSpecItemId: string) => void;
}) {
  /**
   * Состояние операции. Сбрасывается не эффектом, а монтированием: родитель
   * даёт диалогу `key` по выбранному файлу и позиции, поэтому новый выбор — это
   * новый компонент с чистым состоянием. Так повторный выбор того же файла тоже
   * начинает с начала, а правила «не сбрасывать состояние в эффекте» соблюдены
   * без исключений.
   */
  const [category, setCategory] =
    useState<SpecItemFileCategory>(DEFAULT_CATEGORY);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  /**
   * Файл больше не читается браузером (blob отозван или недоступен).
   *
   * Проверка нужна перед КАЖДОЙ попыткой, включая повтор: сервер получает
   * файл как `File` в `FormData`, и «загрузить» нечитаемый blob означало бы
   * отправить пустое тело. Реальный случай для повтора — файл на съёмном
   * носителе или в сетевой папке, который к моменту retry стал недоступен.
   * Тогда retry не имеет смысла: предлагаем выбрать файл заново.
   */
  const [fileUnreadable, setFileUnreadable] = useState(false);

  const requestRef = useRef(0);

  /**
   * Пока диалог закрыт или позиция сменилась, ответы прошлых попыток не нужны:
   * счётчик растёт, и они не проходят проверку актуальности.
   */
  useEffect(() => {
    if (open) return;
    requestRef.current += 1;
    return () => {
      requestRef.current += 1;
    };
  }, [open, specItemId]);

  /** Читается ли файл прямо сейчас: пробное чтение нулевого среза. */
  const isFileReadable = useCallback(async (candidate: File) => {
    try {
      await candidate.slice(0, 1).arrayBuffer();
      return true;
    } catch {
      return false;
    }
  }, []);

  const canSubmit = file !== null && !fileUnreadable && status !== "uploading";

  const submit = useCallback(async () => {
    if (!file || status === "uploading") return;

    // Повторная UX-проверка перед каждой попыткой, включая retry: файл мог
    // измениться, а серверный лимит — остаться тем же.
    if (file.size > MAX_SPEC_ITEM_FILE_BYTES) {
      setStatus("error");
      setError(
        `Файл слишком большой. Максимальный размер — ${MAX_SPEC_ITEM_FILE_LABEL}.`,
      );
      return;
    }

    // Файл мог стать недоступным (носитель отключили, доступ к папке пропал):
    // отправлять пустое тело нельзя, поэтому retry заменяется выбором заново.
    if (!(await isFileReadable(file))) {
      setFileUnreadable(true);
      setStatus("error");
      setError("Файл больше недоступен — выберите его заново.");
      return;
    }

    const requestId = ++requestRef.current;
    setStatus("uploading");
    setError(null);

    // Только то, что предусмотрено контрактом action: файл, вид документа и —
    // для документа к оплате — идентификатор записи. Организация, проект,
    // позиция, автор, путь и время определяются сервером.
    const formData = new FormData();
    formData.set("file", file);
    formData.set("category", category);
    // Поле ставится ВСЕГДА, даже пустым: так у сервера одно представление
    // «оплаты нет» — пустая строка, а не отсутствие поля.
    formData.set("payment_id", paymentId ?? "");

    try {
      const res = await uploadSpecItemFile(orgSlug, specItemId, formData);
      if (requestId !== requestRef.current) return;

      if (!res.success) {
        setStatus("error");
        setError(res.error);
        return;
      }

      setStatus("idle");
      // Наружу отдаём именно серверную запись и позицию, к которой она
      // относится: список обновляется серверным объектом, а не локальной
      // догадкой, и не принимает запись чужой позиции.
      onUploaded(res.data, specItemId);
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      // Server action может отклониться, не дойдя до `ActionResult` (сеть).
      console.error("[FileUploadDialog] загрузка", cause);
      setStatus("error");
      setError("Не удалось загрузить файл");
    }
  }, [
    file,
    status,
    category,
    paymentId,
    orgSlug,
    specItemId,
    onUploaded,
    isFileReadable,
  ]);

  const uploading = status === "uploading";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Закрытие во время загрузки не отменяет её: запрос уже ушёл, и
        // «отмена» здесь была бы ложью. Диалог просто остаётся открытым.
        if (!next && !uploading) onClose();
      }}
    >
      <DialogContent className="sm:max-w-115" showCloseButton={!uploading}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Загрузка файла
          </DialogTitle>
          <DialogDescription className="text-[13px] text-fg-secondary">
            Проверьте файл и выберите категорию — загрузка начнётся после
            подтверждения.
          </DialogDescription>
        </DialogHeader>

        {/* Выбранный файл: до загрузки — обычная строка, во время — uploading,
            после отказа — error. Тот же `Attachment`, что и в списке. */}
       
          <Attachment
            size="sm"
            state={
              uploading ? "uploading" : status === "error" ? "error" : "done"
            }
            className="w-full min-w-0"
          >
            <AttachmentMedia aria-hidden="true">
              {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle className="text-fg">
                {file?.name ?? "Файл недоступен"}
              </AttachmentTitle>
              <AttachmentDescription className="text-fg-dim">
                {file ? formatFileSize(file.size) : "Выберите файл заново"}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions aria-hidden="true">
              {uploading && (
                <span className="font-mono text-[11px] text-fg-muted">
                  Загрузка…
                </span>
              )}
            </AttachmentActions>
          </Attachment>
        

        <RadioGroup
          value={category}
          onValueChange={(value) => setCategory(value as SpecItemFileCategory)}
          disabled={uploading}
          aria-label="Вид документа"
          className="gap-2 sm:grid sm:grid-cols-2"
        >
          {CATEGORY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2.5 text-[13px] text-fg-body"
            >
              <RadioGroupItem value={option.value} />
              {option.label}
            </label>
          ))}
        </RadioGroup>

        {/*
          Ошибка живёт до следующей попытки: пользователь должен успеть её
          прочитать, а не увидеть исчезающее сообщение. Текст серверный —
          клиент его не переписывает.
        */}
        {status === "error" && error && (
          <p role="alert" className="text-[12.5px] text-fg-red">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={uploading}
          >
            Отмена
          </Button>
          {fileUnreadable ? (
            // Файла больше нет — повторять нечего, предлагаем выбрать заново.
            <Button type="button" size="lg" onClick={onClose}>
              Выбрать файл заново
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              onClick={() => void submit()}
              disabled={!canSubmit}
            >
              {uploading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {status === "error" ? "Повторить" : "Загрузить"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
