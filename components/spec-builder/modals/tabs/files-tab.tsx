import { Paperclip } from 'lucide-react';

const FilesTab = () => {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-muted py-12 text-center">
      <Paperclip className="size-8 text-fg-muted" />
      <p className="text-[14px] font-medium text-fg">Файлы и документы</p>
      <p className="max-w-xs text-[12.5px] text-fg-muted">
        Здесь будут счета, спецификации поставщика и другие вложения. Функция в
        разработке.
      </p>
    </div>
  );
}

export default FilesTab