# Snake CLI Game — Project Plan & Bootstrap Spec

## Project Overview

A terminal-based Snake game in Python using the `curses` stdlib library.
The starter repo ships a fully working game engine. Students fork it and add
one self-contained feature each. CI triggers on every branch push and validates
that the game logic still works correctly after the change.

---

## Learning Objectives

- Fork a repo and work on an independent copy
- Understand the separation between logic and rendering
- Write a unit test for a pure function
- Push a branch and watch CI run automatically
- Read a green ✓ / red ✗ on GitHub Actions and act on it

---

## Stack

| Layer | Tool | Reason |
|---|---|---|
| Language | Python 3.12 | stdlib only, zero install friction |
| Terminal rendering | `curses` | Built into Python, no pip needed |
| Game logic | Pure Python functions | Fully testable without a display |
| Lint | `ruff` | Fast, one command |
| Tests | `pytest` | Simple, readable |
| CI | GitHub Actions | Native to GitHub, visible in their fork |
| CD | Not applicable | Honest — nothing to deploy for a CLI game |
[text](about:blank#blocked)
---

## Architecture Principle

Strictly separate logic from rendering so CI can test everything meaningful
without needing a terminal or display.

```
snake/
├── engine.py        ← pure logic, no curses, fully unit testable
├── renderer.py      ← curses rendering only, not tested in CI
├── main.py          ← wires engine + renderer, game loop
├── tests/
│   └── test_engine.py
├── requirements.txt
└── .github/
    └── workflows/
        └── ci.yml
```

---

## `engine.py` — What to Build

All game state and logic lives here. No imports from `curses`. Pure functions
and a state dataclass only.

### Game state

```python
@dataclass
class GameState:
    snake: list[tuple[int, int]]   # list of (row, col), head is index 0
    direction: tuple[int, int]     # (row_delta, col_delta)
    food: tuple[int, int]
    score: int
    alive: bool
    height: int
    width: int
```

### Functions to implement in starter

```python
def new_game(height: int, width: int) -> GameState
def move(state: GameState) -> GameState          # returns new state, immutable
def change_direction(state: GameState, new_dir: tuple[int, int]) -> GameState
def spawn_food(state: GameState) -> tuple[int, int]
def is_collision(state: GameState) -> bool       # wall or self
def did_eat(state: GameState) -> bool
```

### What students add (each is a new function or a modification)

| Feature | What to implement |
|---|---|
| Speed increase | Return a `speed(state) -> int` that maps score to frame delay |
| Wrap walls | Modify `is_collision` — hitting a wall teleports, not dies |
| High score | `load_high_score() -> int` and `save_high_score(score: int)` |
| Pause | A `paused` flag on `GameState` + `toggle_pause(state) -> GameState` |
| Score multiplier | Track `last_eat_tick` on state, multiply score if eaten quickly |

---

## `renderer.py` — What to Build

Thin layer. Only job is to draw `GameState` onto a `curses` window. No logic.

```python
def draw(stdscr, state: GameState) -> None
def draw_game_over(stdscr, state: GameState) -> None
def draw_score(stdscr, state: GameState) -> None
```

---

## `main.py` — What to Build

Game loop only. Reads input, calls engine functions, calls renderer.

```python
def main(stdscr):
    state = new_game(height=20, width=40)
    while state.alive:
        key = stdscr.getch()
        state = handle_input(state, key)
        state = move(state)
        draw(stdscr, state)
        time.sleep(compute_delay(state))

curses.wrapper(main)
```

---

## `tests/test_engine.py` — Starter Tests to Provide

```python
def test_snake_moves_forward():
    state = new_game(20, 40)
    new_state = move(state)
    assert new_state.snake[0] != state.snake[0]

def test_eating_food_grows_snake():
    # place food directly ahead of head, move once
    # assert len(snake) increased by 1

def test_collision_with_wall_kills():
    # move snake into a wall
    # assert state.alive is False

def test_score_increases_on_eat():
    # eat food, assert score went up
```

Students add one test per feature they implement.

---

## CI Workflow — `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches:
      - "**"

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Lint
        run: ruff check .

      - name: Test
        run: pytest tests/ -v
```

**Note:** `curses` rendering is not tested in CI — headless runners have no
display. Only `engine.py` is tested. This is intentional and worth explaining
to students.

---

## `requirements.txt`

```
ruff
pytest
```

No other dependencies. `curses` is stdlib.

---

## Student Contribution Workflow

```
1. Fork the repo on GitHub
2. Clone their fork locally
3. pip install -r requirements.txt
4. python main.py  →  game runs in terminal
5. Create a feature branch:  git checkout -b feature/speed-increase
6. Add their feature to engine.py
7. Add a test to tests/test_engine.py
8. Run pytest locally — must pass
9. git add . && git commit -m "feat: add speed increase mechanic"
10. git push origin feature/speed-increase
11. Open their fork on GitHub → Actions tab → watch CI run
12. Fix if red, repush, confirm green
```

---

## Feature Menu for Students

Hand this out so students can pick without overlap:

| # | Feature | File to edit | Test to write |
|---|---|---|---|
| 1 | Speed increases every 5 points | `engine.py` | `test_speed_at_score_10()` |
| 2 | Walls wrap instead of killing | `engine.py` | `test_wrap_through_wall()` |
| 3 | High score saved to file | `engine.py` | `test_high_score_persists()` |
| 4 | Pause / resume with `p` key | `engine.py` | `test_toggle_pause()` |
| 5 | Score multiplier for quick eats | `engine.py` | `test_multiplier_on_fast_eat()` |

---

## Key Teaching Moments

| Moment | Lesson |
|---|---|
| CI red ✗ immediately after push | CI is a gate, not decoration |
| Renderer not tested in CI | Not everything can or should be tested automatically |
| Pure logic in `engine.py` | Good architecture makes testing possible |
| Peer sees broken CI on their own fork | Ownership — they fix their own pipeline |
| Green ✓ after fix | Fast feedback loop, developer confidence |

---

## What to Tell Students About CD

> "There's no CD here — and that's on purpose. CD means automatically shipping
> code to a running server. A terminal game has no server. We'll see CD in the
> next project. For now, CI alone is doing real work: every push gets checked,
> and broken code is caught before it spreads."

---

## Bootstrap Instructions for Claude Code

When using this plan to bootstrap the project:

1. Create the directory structure exactly as specified above
2. Implement `engine.py` with `GameState` dataclass and all starter functions
3. Implement `renderer.py` with draw functions using `curses`
4. Implement `main.py` with the game loop using `curses.wrapper`
5. Write starter tests in `tests/test_engine.py` covering move, eat, collision, score
6. Add `requirements.txt` with `ruff` and `pytest`
7. Add `.github/workflows/ci.yml` exactly as specified
8. Verify: `python main.py` runs the game, `pytest` passes, `ruff check .` passes
9. The game should be fully playable before any student touches it
