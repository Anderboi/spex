"use client";

import { useRef, useState } from "react";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn } from "lucide-react";

const ASPECT = 1; // квадрат — под слот превью материала

function centerAspectCrop(mediaWidth: number, mediaHeight: number) {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 90 }, ASPECT, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
}

/**
 * Рендерит выбранную область изображения на canvas в исходном (натуральном)
 * разрешении и возвращает JPEG-blob. Учитывает devicePixelRatio для чёткости
 * на ретине, но ограничивает итоговый размер, чтобы не грузить огромные canvas.
 */
async function cropToBlob(
  image: HTMLImageElement,
  crop: PixelCrop,
  maxDim = 1600,
): Promise<Blob> {
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  const cropWidthPx = crop.width * scaleX;
  const cropHeightPx = crop.height * scaleY;

  const scale = Math.min(1, maxDim / Math.max(cropWidthPx, cropHeightPx));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropWidthPx * scale);
  canvas.height = Math.round(cropHeightPx * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.imageSmoothingQuality = "high";

  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    cropWidthPx,
    cropHeightPx,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Не удалось создать изображение")),
      "image/jpeg",
      0.92,
    );
  });
}

export function ImageCropModal({
  open,
  src,
  fileName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  src: string;
  fileName: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [zoom, setZoom] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    setCrop(centerAspectCrop(width, height));
  };

  const handleConfirm = async () => {
    if (!imgRef.current || !completedCrop?.width || !completedCrop?.height)
      return;
    setIsProcessing(true);
    try {
      const blob = await cropToBlob(imgRef.current, completedCrop);
      onConfirm(blob);
    } catch {
      // родитель покажет toast при неудаче загрузки; здесь достаточно не падать
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-[15px]">
            Обрезка изображения
          </DialogTitle>
        </DialogHeader>

        <div className="flex justify-center bg-bg-muted rounded-lg overflow-hidden max-h-[60vh]">
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={ASPECT}
            circularCrop={false}
            keepSelection
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={src}
              alt={fileName}
              onLoad={handleImageLoad}
              style={{ transform: `scale(${zoom})`, maxHeight: "60vh" }}
              className="transition-transform"
            />
          </ReactCrop>
        </div>

        <div className="flex items-center gap-3 px-1">
          <ZoomIn className="size-4 text-fg-muted shrink-0" />
          <Slider
            min={1}
            max={3}
            step={0.01}
            value={[zoom]}
            onValueChange={(value) => {
              const v = Array.isArray(value) ? value[0] : value;
              if (typeof v === "number") setZoom(v);
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isProcessing}>
            Отмена
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isProcessing || !completedCrop}
          >
            {isProcessing ? "Обработка…" : "Готово"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
