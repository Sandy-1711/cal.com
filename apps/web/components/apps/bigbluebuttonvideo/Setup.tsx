import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { Form, TextField } from "@calcom/ui/components/form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Toaster } from "sonner";

type FormValues = {
  serverUrl: string;
  sharedSecret: string;
};

export default function BigBlueButtonSetup() {
  const { t } = useLocale();
  const router = useRouter();
  const form = useForm<FormValues>({
    defaultValues: { serverUrl: "", sharedSecret: "" },
  });

  const [errorMessage, setErrorMessage] = useState("");

  return (
    <div className="flex h-screen bg-emphasis">
      <div className="m-auto rounded bg-default p-5 md:w-[560px] md:p-10">
        <div className="stack-y-5 md:stack-y-0 flex flex-col md:flex-row md:space-x-5">
          <div>
            {/* eslint-disable @next/next/no-img-element */}
            <img
              src="/api/app-store/bigbluebuttonvideo/icon.svg"
              alt={t("bigbluebutton_logo_alt")}
              className="h-12 w-12 max-w-2xl"
            />
          </div>
          <div className="flex w-10/12 flex-col">
            <h1 className="text-default">{t("connect_bigbluebutton")}</h1>
            <div className="mt-1 text-sm">{t("credentials_stored_encrypted")}</div>
            <div className="my-2 mt-3">
              <Form
                form={form}
                handleSubmit={async (values) => {
                  setErrorMessage("");
                  try {
                    const res = await fetch("/api/integrations/bigbluebuttonvideo/add", {
                      method: "POST",
                      body: JSON.stringify(values),
                      headers: { "Content-Type": "application/json" },
                    });
                    const json = await res.json().catch(() => null);
                    if (!res.ok) {
                      setErrorMessage(json?.message || t("something_went_wrong"));
                      return;
                    }
                    if (json?.url) {
                      router.push(json.url);
                    } else {
                      setErrorMessage(t("something_went_wrong"));
                    }
                  } catch {
                    setErrorMessage(t("something_went_wrong"));
                  }
                }}>
                <fieldset className="stack-y-2" disabled={form.formState.isSubmitting}>
                  <TextField
                    required
                    type="text"
                    {...form.register("serverUrl")}
                    label={t("bigbluebutton_server_url")}
                    placeholder={t("bigbluebutton_server_url_placeholder")}
                  />
                  <TextField
                    required
                    type="password"
                    {...form.register("sharedSecret")}
                    label={t("bigbluebutton_shared_secret")}
                    placeholder={t("bigbluebutton_shared_secret_placeholder")}
                    autoComplete="off"
                  />
                </fieldset>

                {errorMessage && <Alert severity="error" title={errorMessage} className="my-4" />}

                <div className="mt-5 justify-end space-x-2 sm:mt-4 sm:flex rtl:space-x-reverse">
                  <Button type="button" color="secondary" onClick={() => router.back()}>
                    {t("cancel")}
                  </Button>
                  <Button type="submit" loading={form.formState.isSubmitting}>
                    {t("save")}
                  </Button>
                </div>
              </Form>
            </div>
          </div>
        </div>
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}
