import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Building2 } from "lucide-react";
import { createOrganization } from '../actions';

export const metadata = {
  title: "Создание организации | Spex",
};

export default function OnboardingPage() {
  async function handleCreate(formData: FormData) {
    "use server";
    await createOrganization(formData);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-md w-full shadow-lg border-border">
        <CardHeader className="text-center space-y-2">
          <div className="p-3 bg-primary/10 text-primary rounded-full w-fit mx-auto">
            <Building2 className="size-8" />
          </div>
          <CardTitle className="text-2xl font-bold">
            Добро пожаловать в Spex
          </CardTitle>
          <CardDescription>
            Для начала работы создайте вашу студию или компанию. Вы сможете
            пригласить коллег позже.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Название организации / студии</Label>
              <Input
                id="name"
                name="name"
                placeholder="Например: Studio Minimal"
                required
                minLength={2}
              />
            </div>

            <Button type="submit" className="w-full" size="lg">
              Создать и продолжить
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
