import { cn } from '@/lib/utils';
import React from "react";

/**
 * Подпись блока внутри модалки: «Описание продукта», «Характеристики».
 *
 * Лежит в общем `components/layout`, а не в `spec-builder`: блоки с такой
 * подписью есть и в модалке позиции, и в модалках библиотеки материалов.
 */
const ModalBlockLabel = ({ children, className }: { children: React.ReactNode, className?: string }) => {
  return (
    <h4 className={cn("font-mono text-xs text-fg-muted tracking-wider uppercase", className)}>
      {children}
    </h4>
  );
};

export default ModalBlockLabel;
