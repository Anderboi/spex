"use client";

import  { useState } from "react";
import {
  Plus,
  Search,
  Filter,
  Layers,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/utils";
import { LibraryMaterial } from '@/lib/types';
import PageHeader from '@/components/layout/PageHeader';

export default function MaterialsLibraryPage() {
  const [search, setSearch] = useState("");
  const [materials] = useState<LibraryMaterial[]>([]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <PageHeader>Библиотека материалов</PageHeader>
          <p className="text-sm text-muted-foreground mt-1">
            Сохраненные позиции и образцы для быстрого добавления в проекты
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Добавить в библиотеку
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по артикулу, бренду, материалу..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Карточки материалов (Визуальный каталожный вид) */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {materials.map((mat) => (
          <div
            key={mat.id}
            className="group rounded-xl border border-border bg-card overflow-hidden hover:border-foreground/30 transition-all flex flex-col"
          >
            {/* Превью материала */}
            <div className="h-40 bg-[repeating-linear-gradient(135deg,#e9e4d9,#e9e4d9_5px,#f0ebe1_5px,#f0ebe1_10px)] relative p-3 flex flex-col justify-between">
              <span className="self-start text-[10px] font-mono uppercase bg-background/80 backdrop-blur px-2 py-0.5 rounded border border-border">
                {mat.category}
              </span>
            </div>

            {/* Описание */}
            <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
              <div>
                <div className="text-xs text-muted-foreground font-mono">
                  {mat.brand}
                </div>
                <h3 className="font-semibold text-sm line-clamp-1">
                  {mat.name}
                </h3>
                {mat.supplier && (
                  <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50 flex items-center justify-between">
                    <span>Поставщик:</span>
                    <span className="font-medium text-foreground">
                      {mat.supplier.name}
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-border">
                <span className="font-mono text-xs font-semibold">
                  {fmt(mat.price)} ₽ / {mat.unit}
                </span>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                  В проект <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
