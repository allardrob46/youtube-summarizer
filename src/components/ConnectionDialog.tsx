/**
 * Where the phone is told the server address and passcode.
 * Saved on the phone only, so the passcode never has to be baked into the APK.
 */
import { Button, Description, Dialog, FieldError, Input, Label, TextField } from "heroui-native";
import { type JSX, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { getSettings, saveSettings } from "@/lib/storage";

type Props = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  buildUrl: string;
};

export function ConnectionDialog({ isOpen, onOpenChange, buildUrl }: Props): JSX.Element {
  const [serverUrl, setServerUrl] = useState("");
  const [passcode, setPasscode] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    void getSettings().then((s) => {
      setServerUrl(s.serverUrl);
      setPasscode(s.passcode);
      setUrlError(null);
    });
  }, [isOpen]);

  const onSave = async () => {
    const url = serverUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      setUrlError("Start the address with https://");
      return;
    }
    await saveSettings({ serverUrl: url, passcode: passcode.trim() });
    onOpenChange(false);
  };

  const onClear = async () => {
    await saveSettings({ serverUrl: "", passcode: "" });
    onOpenChange(false);
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Dialog.Content>
            <Dialog.Close />
            <Dialog.Title>Connection</Dialog.Title>
            <Dialog.Description>
              Your summary server. Leave the address empty to use demo mode
              {buildUrl ? " or the address this app was built with" : ""}.
            </Dialog.Description>

            <View className="mt-5 gap-4">
              <TextField isInvalid={urlError !== null}>
                <Label>Server address</Label>
                <Input
                  value={serverUrl}
                  onChangeText={(t) => {
                    setServerUrl(t);
                    setUrlError(null);
                  }}
                  placeholder={buildUrl || "https://yt.example.com/summarize"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                {urlError ? (
                  <FieldError>{urlError}</FieldError>
                ) : (
                  <Description>The full address, ending in /summarize.</Description>
                )}
              </TextField>

              <TextField>
                <Label>Passcode</Label>
                <Input
                  value={passcode}
                  onChangeText={setPasscode}
                  placeholder="The APP_PASSCODE from your server"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
              </TextField>
            </View>

            <View className="mt-6 gap-2">
              <Button onPress={onSave}>Save connection</Button>
              <Button variant="ghost" onPress={onClear}>
                Clear and use defaults
              </Button>
            </View>
          </Dialog.Content>
        </KeyboardAvoidingView>
      </Dialog.Portal>
    </Dialog>
  );
}
