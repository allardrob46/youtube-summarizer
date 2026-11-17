/**
 * Piece 3: Summary detail.
 * Overview, timestamped key points (tap a time to jump there in YouTube),
 * answers to your questions, then your own notes, saved with the summary.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Button,
  Card,
  Chip,
  Dialog,
  PressableFeedback,
  Separator,
  Spinner,
  TextArea,
  Typography,
  useToast,
} from "heroui-native";
import { type JSX, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

import { formatDate, Icon, MONO, Screen, SectionTitle } from "@/components/ui";
import { deleteSummary, type KeyPoint, type Summary, updateSummary } from "@/lib/storage";
import { useSummary } from "@/lib/useLibrary";
import { formatTimestamp, openAt } from "@/lib/youtube";

type SaveState = "idle" | "saving" | "saved";

export default function SummaryScreen(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const item = useSummary(id);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/library"));

  if (item === undefined) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      </Screen>
    );
  }

  if (item === null) {
    return (
      <Screen>
        <TopBar onBack={back} />
        <View className="flex-1 items-start justify-center px-8 pb-24">
          <Typography.Heading type="h4">This summary is gone</Typography.Heading>
          <Typography.Paragraph color="muted" className="mt-2">
            It may have been deleted from the Library.
          </Typography.Paragraph>
          <Button className="mt-6" onPress={() => router.replace("/library")}>
            Back to Library
          </Button>
        </View>
      </Screen>
    );
  }

  return <SummaryBody item={item} onBack={back} />;
}

function TopBar({ onBack, children }: { onBack: () => void; children?: React.ReactNode }): JSX.Element {
  return (
    <View className="flex-row items-center justify-between px-2 py-1">
      <Button variant="ghost" onPress={onBack} accessibilityLabel="Back">
        <Icon name="chevron-back" size={22} />
        <Button.Label>Back</Button.Label>
      </Button>
      <View className="flex-row items-center">{children}</View>
    </View>
  );
}

function SummaryBody({ item, onBack }: { item: Summary; onBack: () => void }): JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const [notes, setNotes] = useState(item.notes);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  // Autosave notes shortly after typing stops.
  const onChangeNotes = (text: string) => {
    setNotes(text);
    setSaveState("saving");
    pending.current = text;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = null;
      void updateSummary(item.id, { notes: text }).then(() => setSaveState("saved"));
    }, 600);
  };

  // Leaving the screen mid-typing still saves what was written.
  useEffect(() => {
    const summaryId = item.id;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) void updateSummary(summaryId, { notes: pending.current });
    };
  }, [item.id]);

  const toggleKeep = async () => {
    await updateSummary(item.id, { kept: !item.kept });
    toast.show(item.kept ? "No longer kept" : "Kept at the top of your Library");
  };

  const onDelete = async () => {
    setConfirmDelete(false);
    await deleteSummary(item.id);
    toast.show("Summary deleted");
    router.replace("/library");
  };

  const { overview, keyPoints, answers } = item.summary;

  return (
    <Screen>
      <TopBar onBack={onBack}>
        <Button
          isIconOnly
          variant="ghost"
          onPress={toggleKeep}
          accessibilityLabel={item.kept ? "Stop keeping" : "Keep"}
        >
          <Icon name={item.kept ? "bookmark" : "bookmark-outline"} size={22} color="accent" />
        </Button>
        <Button
          isIconOnly
          variant="ghost"
          onPress={() => setConfirmDelete(true)}
          accessibilityLabel="Delete summary"
        >
          <Icon name="trash-outline" size={22} color="muted" />
        </Button>
      </TopBar>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="px-5 pb-16" keyboardShouldPersistTaps="handled">
          <Typography.Heading type="h3" className="mt-2">
            {item.title}
          </Typography.Heading>
          <View className="mt-2 flex-row flex-wrap items-center gap-2">
            <Typography type="body-sm" color="muted">
              {formatDate(item.createdAt)}
            </Typography>
            {item.demo ? (
              <Chip size="sm" variant="soft" color="warning">
                Demo sample
              </Chip>
            ) : null}
          </View>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4 self-start"
            onPress={() => void openAt(item.videoId)}
          >
            <Icon name="logo-youtube" size={18} color="accent" />
            <Button.Label>Watch on YouTube</Button.Label>
          </Button>

          <SectionTitle>Overview</SectionTitle>
          {overview ? (
            <Typography.Paragraph className="leading-6">{overview}</Typography.Paragraph>
          ) : (
            <Typography.Paragraph color="muted">No overview came back for this video.</Typography.Paragraph>
          )}

          <SectionTitle
            aside={
              keyPoints.length > 0 ? (
                <Typography type="body-xs" color="muted">
                  Tap a time to jump there
                </Typography>
              ) : undefined
            }
          >
            Key points
          </SectionTitle>
          {keyPoints.length > 0 ? (
            <Card className="py-1">
              {keyPoints.map((kp, i) => (
                <View key={`${kp.timestamp}-${i}`}>
                  {i > 0 ? <Separator /> : null}
                  <KeyPointRow point={kp} videoId={item.videoId} />
                </View>
              ))}
            </Card>
          ) : (
            <Typography.Paragraph color="muted">No key points for this video.</Typography.Paragraph>
          )}

          {item.questions.length > 0 || answers.length > 0 ? (
            <>
              <SectionTitle>Your questions</SectionTitle>
              <View className="gap-3">
                {(answers.length > 0
                  ? answers
                  : item.questions.map((q) => ({ question: q, answer: "" }))
                ).map((a, i) => (
                  <Card key={i} variant="secondary">
                    <Card.Body className="gap-2">
                      <Card.Title>{a.question}</Card.Title>
                      <Typography.Paragraph color={a.answer ? "default" : "muted"} className="leading-6">
                        {a.answer || "No answer came back for this question."}
                      </Typography.Paragraph>
                    </Card.Body>
                  </Card>
                ))}
              </View>
            </>
          ) : null}

          <SectionTitle
            aside={
              <Typography type="body-xs" color="muted" accessibilityLiveRegion="polite">
                {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : ""}
              </Typography>
            }
          >
            Your notes
          </SectionTitle>
          <TextArea
            value={notes}
            onChangeText={onChangeNotes}
            placeholder="What do you want to remember from this?"
            className="min-h-40"
            textAlignVertical="top"
            accessibilityLabel="Your notes"
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <Dialog isOpen={confirmDelete} onOpenChange={setConfirmDelete}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Delete this summary?</Dialog.Title>
            <Dialog.Description>Your notes on it go too. This cannot be undone.</Dialog.Description>
            <View className="mt-6 gap-2">
              <Button variant="danger" onPress={onDelete}>
                Delete summary
              </Button>
              <Button variant="ghost" onPress={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </Screen>
  );
}

/** The app's signature row: a monospaced time in the margin, the point beside it. */
function KeyPointRow({ point, videoId }: { point: KeyPoint; videoId: string }): JSX.Element {
  const time = formatTimestamp(point.timestamp);
  return (
    <PressableFeedback
      onPress={() => void openAt(videoId, point.timestamp)}
      accessibilityRole="link"
      accessibilityLabel={`Open video at ${time}. ${point.text}`}
      className="min-h-12 flex-row gap-3 px-4 py-3"
    >
      <View className="w-16 border-r border-accent/40 pr-3">
        <Typography className="text-accent" weight="semibold" style={{ fontFamily: MONO }}>
          {time}
        </Typography>
      </View>
      <Typography.Paragraph className="flex-1 leading-6">{point.text}</Typography.Paragraph>
    </PressableFeedback>
  );
}
