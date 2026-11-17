/**
 * Piece 1: Summarize.
 * Paste a link, optionally say what you are looking for, send it off.
 * On success the summary is saved and the detail screen opens.
 */
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import {
  Button,
  Card,
  Chip,
  Description,
  FieldError,
  Input,
  Label,
  Spinner,
  TextField,
  Typography,
  useThemeColor,
} from "heroui-native";
import { type JSX, useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

import { ConnectionDialog } from "@/components/ConnectionDialog";
import { Icon, Screen } from "@/components/ui";
import { ApiError, getConnection, summarize, type Connection } from "@/lib/api";
import { newId, saveSummary, subscribe } from "@/lib/storage";
import { parseVideoId } from "@/lib/youtube";

const MAX_QUESTIONS = 5;
const BUILD_URL = (process.env.EXPO_PUBLIC_SERVER_URL ?? "").trim();

export default function SummarizeScreen(): JSX.Element {
  const router = useRouter();
  const spinnerColor = useThemeColor("accent-foreground");
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);

  const refreshConnection = useCallback(() => {
    void getConnection().then(setConnection);
  }, []);

  useEffect(() => {
    refreshConnection();
    return subscribe(refreshConnection);
  }, [refreshConnection]);

  const demo = connection?.source === "none";

  const pasteLink = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setLink(text.trim());
      setLinkError(null);
    }
  };

  const setQuestion = (index: number, value: string) => {
    setQuestions((qs) => qs.map((q, i) => (i === index ? value : q)));
  };

  const removeQuestion = (index: number) => {
    setQuestions((qs) => (qs.length === 1 ? [""] : qs.filter((_, i) => i !== index)));
  };

  const onSubmit = async () => {
    const videoId = parseVideoId(link);
    if (!videoId) {
      setLinkError("That does not look like a YouTube video link.");
      return;
    }
    setError(null);
    setBusy(true);
    const cleanQuestions = questions.map((q) => q.trim()).filter(Boolean);
    try {
      const result = await summarize({ url: link.trim(), questions: cleanQuestions }, videoId);
      const id = newId();
      await saveSummary({
        id,
        url: result.url,
        videoId: result.videoId,
        title: result.title,
        createdAt: new Date().toISOString(),
        questions: result.questions,
        summary: result.summary,
        notes: "",
        kept: false,
        demo,
      });
      setLink("");
      setQuestions([""]);
      router.push({ pathname: "/summary/[id]", params: { id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="px-5 pb-12"
          keyboardShouldPersistTaps="handled"
        >
          <View className="mt-4 flex-row items-center justify-between">
            <Chip
              size="sm"
              variant="soft"
              color={demo ? "warning" : "success"}
            >
              {demo ? "Demo mode" : "Server connected"}
            </Chip>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => setConnectionOpen(true)}
              accessibilityLabel="Connection settings"
            >
              <Icon name="settings-outline" size={18} />
              <Button.Label>Connection</Button.Label>
            </Button>
          </View>

          <Typography.Heading type="h2" className="mt-6">
            What are we watching?
          </Typography.Heading>
          <Typography.Paragraph color="muted" className="mt-2">
            Paste a YouTube link. Add what you want out of it and the summary answers that first.
          </Typography.Paragraph>

          <View className="mt-7">
            <TextField isRequired isInvalid={linkError !== null}>
              <Label>YouTube link</Label>
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Input
                    value={link}
                    onChangeText={(t) => {
                      setLink(t);
                      setLinkError(null);
                    }}
                    placeholder="youtube.com/watch?v=..."
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="next"
                    editable={!busy}
                  />
                </View>
                <Button variant="secondary" onPress={pasteLink} isDisabled={busy}>
                  <Icon name="clipboard-outline" size={18} />
                  <Button.Label>Paste</Button.Label>
                </Button>
              </View>
              {linkError ? <FieldError>{linkError}</FieldError> : null}
            </TextField>
          </View>

          <View className="mt-7">
            <Label>What are you looking for?</Label>
            <Description className="mb-3">
              Optional. One question per box, up to {MAX_QUESTIONS}.
            </Description>
            <View className="gap-2">
              {questions.map((q, i) => (
                <View key={i} className="flex-row items-center gap-2">
                  <View className="flex-1">
                    <Input
                      value={q}
                      onChangeText={(t) => setQuestion(i, t)}
                      placeholder={i === 0 ? "e.g. Which tools does he recommend?" : "Another question"}
                      editable={!busy}
                      accessibilityLabel={`Question ${i + 1}`}
                    />
                  </View>
                  {questions.length > 1 || q.length > 0 ? (
                    <Button
                      isIconOnly
                      variant="ghost"
                      onPress={() => removeQuestion(i)}
                      isDisabled={busy}
                      accessibilityLabel={`Remove question ${i + 1}`}
                    >
                      <Icon name="close" size={20} color="muted" />
                    </Button>
                  ) : null}
                </View>
              ))}
            </View>
            {questions.length < MAX_QUESTIONS ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 self-start"
                onPress={() => setQuestions((qs) => [...qs, ""])}
                isDisabled={busy}
              >
                <Icon name="add" size={18} color="accent" />
                <Button.Label>Add a question</Button.Label>
              </Button>
            ) : null}
          </View>

          {error ? (
            <Card variant="secondary" className="mt-6">
              <Card.Body className="gap-1">
                <Card.Title className="text-danger">Could not summarize</Card.Title>
                <Card.Description>{error}</Card.Description>
              </Card.Body>
            </Card>
          ) : null}

          <Button size="lg" className="mt-8" onPress={onSubmit} isDisabled={busy}>
            {busy ? (
              <>
                <Spinner size="sm" color={spinnerColor} />
                <Button.Label>Reading the video</Button.Label>
              </>
            ) : (
              <Button.Label>Summarize video</Button.Label>
            )}
          </Button>
          {busy ? (
            <Typography type="body-sm" color="muted" align="center" className="mt-3">
              Short videos take a few seconds. Long ones can take a couple of minutes.
            </Typography>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConnectionDialog
        isOpen={connectionOpen}
        onOpenChange={setConnectionOpen}
        buildUrl={BUILD_URL}
      />
    </Screen>
  );
}
