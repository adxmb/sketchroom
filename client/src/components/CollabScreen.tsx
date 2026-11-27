import type { RoomView } from "../../../server/src/protocol";
import type { RoomState } from "../roomState";
import { ChatBox } from "./ChatBox";
import { PlayerList } from "./PlayerList";
import { SharedBoard } from "./SharedBoard";

type SharedBoardProps = Parameters<typeof SharedBoard>[0];

export interface CollabActions {
    onLocal: SharedBoardProps["onLocal"];
    onSend: SharedBoardProps["onSend"];
    onCursor: SharedBoardProps["onCursor"];
    onUndo: () => void;
    onClear: () => void;
    onChat: (text: string) => void;
}

/** The screen of a collab room: one board for everyone, the players, and a chat */
export function CollabScreen({
    room,
    state,
    actions,
}: {
    room: RoomView;
    state: RoomState;
    actions: CollabActions;
}) {
    return (
        <div className="collab">
            <section className="card board">
                <SharedBoard
                    fileName={`sketchroom-${room.code}`}
                    myId={state.playerId}
                    players={room.players}
                    strokes={state.board}
                    cursors={state.cursors}
                    onLocal={actions.onLocal}
                    onSend={actions.onSend}
                    onCursor={actions.onCursor}
                    onUndo={actions.onUndo}
                    onClear={actions.onClear}
                />
            </section>
            <div className="collab-side">
                <section className="card">
                    <h2>
                        Players{" "}
                        <span className="muted">({room.players.length})</span>
                    </h2>
                    <PlayerList room={room} myId={state.playerId} />
                </section>
                <section className="card">
                    <ChatBox
                        messages={state.chat}
                        placeholder="Say something"
                        onSend={actions.onChat}
                    />
                </section>
            </div>
        </div>
    );
}
