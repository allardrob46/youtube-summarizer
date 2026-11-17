/**
 * Piece 2: Library.
 * Every summary saved on this phone. Kept ones stay pinned at the top;
 * anything can be deleted (with a confirm, since it cannot be undone).
 */
import { useRouter } from "expo-router";
import {
  Button,
  Card,
  Chip,
  Dialog,
  PressableFeedback,
  Skeleton,
  Typography,
  useToast,
} from "heroui-native";
import { type JSX, useState } from "react";
import { FlatList, Image, View } from "react-native";

import { formatDate, Icon, Screen } from "@/components/ui";
import { deleteSummary, type Summary, updateSummary } from "@/lib/storage";
import { useLibrary } from "@/lib/useLibrary";
import { thumbnailUrl } from "@/lib/youtube";

export default function LibraryScreen(): JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const { items, loading } = useLibrary();
  const [pendingDelete, setPendingDelete] = useState<Summary | null>(null);

  const toggleKeep = async (item: Summary) => {
    await updateSummary(item.id, { kept: !item.kept });
    toast.show(item.kept ? "No longer kept" : "Kept at the top");
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await deleteSummary(pendingDelete.id);
    setPendingDelete(null);
    toast.show("Summary deleted");
  };

  const keptCount = items.filter((i) => i.kept).length;

  return (
    <Screen>
      <View className="px-5 pb-3 pt-6">
        <Typography.Heading type="h2">Library</Typography.Heading>
        {items.length > 0 ? (
          <Typography type="body-sm" color="muted" className="mt-1">
            {items.length} saved{keptCount ? `, ${keptCount} kept` : ""}
          </Typography>
        ) : null}
      </View>

      {loading ? (
        <View className="gap-3 px-5 pt-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </View>
      ) : items.length === 0 ? (
        <View className="flex-1 items-start justify-center px-8 pb-24">
          <Icon name="library-outline" size={36} color="muted" />
          <Typography.Heading type="h4" className="mt-4">
            Nothing saved yet
          </Typography.Heading>
          <Typography.Paragraph color="muted" className="mt-2">
            Every video you summarize lands here, with your notes.
          </Typography.Paragraph>
          <Button className="mt-6" onPress={() => router.navigate("/")}>
            Summarize a video
          </Button>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-5 pb-10 gap-3"
          renderItem={({ item }) => (
            <LibraryRow
              item={item}
              onOpen={() => router.push({ pathname: "/summary/[id]", params: { id: item.id } })}
              onToggleKeep={() => void toggleKeep(item)}
              onDelete={() => setPendingDelete(item)}
            />
          )}
        />
      )}

      <Dialog isOpen={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Delete this summary?</Dialog.Title>
            <Dialog.Description>
              {pendingDelete?.title}. Your notes on it go too. This cannot be undone.
            </Dialog.Description>
            <View className="mt-6 gap-2">
              <Button variant="danger" onPress={confirmDelete}>
                Delete summary
              </Button>
              <Button variant="ghost" onPress={() => setPendingDelete(null)}>
                Cancel
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </Screen>
  );
}

function LibraryRow({
  item,
  onOpen,
  onToggleKeep,
  onDelete,
}: {
  item: Summary;
  onOpen: () => void;
  onToggleKeep: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <Card className="p-0">
      <PressableFeedback
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open summary: ${item.title}`}
        className="flex-row gap-3 p-3"
      >
        <Image
          source={{ uri: thumbnailUrl(item.videoId) }}
          style={{ width: 112, height: 63 }}
          className="rounded-lg bg-surface-tertiary"
          accessibilityIgnoresInvertColors
        />
        <View className="flex-1">
          <Typography weight="semibold" numberOfLines={2}>
            {item.title}
          </Typography>
          <View className="mt-1 flex-row flex-wrap items-center gap-2">
            <Typography type="body-xs" color="muted">
              {formatDate(item.createdAt)}
            </Typography>
            {item.notes.trim() ? (
              <Typography type="body-xs" color="muted">
                Has notes
              </Typography>
            ) : null}
            {item.demo ? (
              <Chip size="sm" variant="soft" color="warning">
                Demo
              </Chip>
            ) : null}
          </View>
        </View>
      </PressableFeedback>
      <View className="flex-row items-center justify-end gap-1 border-t border-border px-2 py-1">
        <Button
          size="sm"
          variant="ghost"
          onPress={onToggleKeep}
          accessibilityLabel={item.kept ? "Stop keeping" : "Keep"}
        >
          <Icon name={item.kept ? "bookmark" : "bookmark-outline"} size={18} color="accent" />
          <Button.Label>{item.kept ? "Kept" : "Keep"}</Button.Label>
        </Button>
        <Button size="sm" variant="ghost" onPress={onDelete} accessibilityLabel="Delete">
          <Icon name="trash-outline" size={18} color="muted" />
          <Button.Label>Delete</Button.Label>
        </Button>
      </View>
    </Card>
  );
}
