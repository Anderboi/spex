<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Tailwind: переопределение утилит одной группы

Порядок классов в `className` ничего не решает — выигрывает тот, что позже в
собранном CSS. Tailwind v4 выводит утилиты одной группы по алфавиту, поэтому
`.flex` идёт раньше `.grid`, `.flex-row` раньше `.flex-col` (сравнивать можно
скриптом: собрать пробный CSS через `@tailwindcss/postcss` и найти индексы
правил). Класс-переопределение из `className` в таком случае молча проигрывает
базовому.

Отсюда правило: если базовый компонент (`DialogContent`, `Card`, …) задаёт
display/flex-направление, не «перебивайте» его классом из места вызова — правьте
базу или задавайте значение через `!important`. Именно на этом ломался
`DialogContent`: базовый `grid` перебивал `flex flex-col` модалки, и
`shrink-0`-футер с `flex-1`-прокруткой не работали — футер уезжал за границу
попапа.
