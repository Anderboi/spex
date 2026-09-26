import React from "react";

/**
 * Подпись блока внутри модалки: «Описание продукта», «Характеристики».
 *
 * Лежит в общем `components/layout`, а не в `spec-builder`: блоки с такой
 * подписью есть и в модалке позиции, и в модалках библиотеки материалов.
 */
const ModalBlockLabel = ({ children }: { children: React.ReactNode }) => {
  return (
    <h4 className="font-mono text-xs text-fg-muted tracking-wider uppercase">
      {children}
    </h4>
  );
};

export default ModalBlockLabel;
