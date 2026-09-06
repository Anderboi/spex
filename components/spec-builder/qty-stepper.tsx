"use client";
import { Minus, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";

export function QtyStepper({
  qty,
  unit,
  onChange,
  editable,
  showUnit = true,
}: {
  qty: number;
  unit: string;
  editable: boolean;
  showUnit?: boolean;
  onChange: (d: number) => void;
}) {
  return (
    <ButtonGroup>
      <Button
        className="size-7 bg-bg-card"
        size="sm"
        variant="outline"
        onClick={() => onChange(-1)}
        disabled={qty <= 1}
        aria-label="Уменьшить количество"
      >
        <Minus className="size-3" />
      </Button>
      <InputGroup className="h-7 min-w-14 items-center bg-bg-card">
        <InputGroupInput
          className="text-center font-mono text-[12px] tabular-nums"
          value={qty}
        />
        <InputGroupAddon align="inline-end">
          {showUnit && (
            <span className="text-[11px] ml-1 text-fg-muted">{unit}</span>
          )}
        </InputGroupAddon>
      </InputGroup>
      <Button
        size="sm"
        className="size-7 bg-bg-card"
        variant="outline"
        onClick={() => onChange(1)}
        aria-label="Увеличить количество"
      >
        <Plus className="size-3" />
      </Button>
    </ButtonGroup>
  );
}
