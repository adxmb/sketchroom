import { PLAYER_COLOURS, RoomView } from "../../../server/src/protocol";

export function PlayerList({
    room,
    myId,
}: {
    room: RoomView;
    myId: string | null;
}) {
    const drawerId = room.game?.drawerId;
    return (
        <ul className="players">
            {room.players.map((p) => (
                <li key={p.id}>
                    <span
                        className="avatar"
                        aria-hidden="true"
                        style={
                            room.mode === "collab"
                                ? {
                                      background:
                                          PLAYER_COLOURS[p.colour] ??
                                          PLAYER_COLOURS[0],
                                  }
                                : undefined
                        }
                    >
                        {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="player-name">{p.name}</span>
                    {p.id === myId && <span className="badge">You</span>}
                    {p.id === drawerId && (
                        <span className="badge draw">Drawing</span>
                    )}
                    {!p.connected && (
                        <span className="badge quiet">Offline</span>
                    )}
                    {p.guessed && <span className="badge good">Found it</span>}
                    {p.isHost && <span className="badge host">Host</span>}
                    {p.isGuest && <span className="badge quiet">Guest</span>}
                    {room.game && <span className="points">{p.score}</span>}
                </li>
            ))}
        </ul>
    );
}
