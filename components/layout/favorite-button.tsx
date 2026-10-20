import { Heart } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

/**
 * Сердце материала: личная отметка «избранное».
 *
 * Состояние видно без наведения: заливка и цвет иконки, плюс `aria-pressed`.
 * На превью широкой карточки кнопка лежит поверх картинки в правом нижнем углу,
 * в мобильной строке — отдельной кнопкой рядом с меню действий.
 */
function FavoriteButton({
  favorite,
  materialName,
  onToggle,
  className,
}: {
  favorite: boolean;
  materialName: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      aria-pressed={favorite}
      aria-label={
        favorite
          ? `Убрать «${materialName}» из избранного`
          : `Добавить «${materialName}» в избранное`
      }
      title={favorite ? "Убрать из избранного" : "В избранное"}
      onClick={onToggle}
      className={cn(
        "rounded-full border-none bg-bg/85 p-0 backdrop-blur-sm hover:bg-bg-white",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-4 transition-colors",
          favorite ? "fill-fg text-fg" : "text-fg-body",
        )}
      />
    </Button>
  );
}
export default FavoriteButton;
