/// <reference path="types.ts"/>
/// <reference path="core.ts"/>
/// <reference path="scanner.ts"/>
/// <reference path="parser.ts"/>
/// <reference path="binder.ts"/>

module ts {
    export interface CheckFlowEnv<T> {
        reachable(): T;
        unreachable(): T;
        uninitialized(): T;
        isUninitialized(s: T): boolean;
        isReachable(s: T): boolean;
        or(s1: T, s2: T): T;
        copy(s: T): T;

        error(n: Node, message: DiagnosticMessage, arg0?: any);
    }

    export interface CheckFlowState<T> {
        state: T;
        isForked: boolean;
        trueState: T;
        falseState: T;

        setState(s: T);
        fork(): void;
        merge(trueState: T, falseState: T);
    }

    export interface CheckFlowWalker<T> {
        (node: Node, state: CheckFlowState<T>, check: (n: Node) => void): void;
    }

    export function checkFlow<T>(n: Node, env: CheckFlowEnv<T>, walker: CheckFlowWalker<T>): CheckFlowState<T> {
        var state: CheckFlowState<T> = {
            state: env.reachable(),
            isForked: false,
            trueState: undefined,
            falseState: undefined,
            setState: setState,
            fork: fork,
            merge: merge
        };
        // label name -> index in 'labelStack'
        var labels: Map<number> = {};
        // state at all seen labels
        var labelStack: T[] = [];
        // indices of implicit labels in 'labelStack'
        var implicitLabels: number[] = [];

        walker(n, state, check);

        return state;
        function setState(s: T) {
            state.isForked = false;
            state.state = s;
            state.trueState = state.falseState = undefined;
        }

        function fork(): void {
            if (!state.isForked) {
                state.isForked = true;
                state.trueState = env.copy(state.state);
                state.falseState = env.copy(state.state);
                state.state = undefined;
            }
        }

        function merge(trueState: T, falseState: T): void {
            if (state.isForked) {
                setState(env.or(trueState, falseState))
            }
        }

        function pushNamedLabel(name: Identifier): boolean {
            if (hasProperty(labels, name.text)) {
                return false;
            }
            var newLen = labelStack.push(env.uninitialized());
            labels[name.text] = newLen - 1;
            return true;
        }

        function pushImplicitLabel(): number {
            var newLen = labelStack.push(env.uninitialized());
            implicitLabels.push(newLen - 1);
            return newLen - 1;
        }

        function setFinalStateAtLabel(mergedStates: T, outerState: T, name: Identifier): void {
            if (env.isUninitialized(mergedStates)) {
                if (name) {
                    env.error(name, Diagnostics.Unused_label);
                }
                setState(outerState);
            }
            else {
                setState(env.or(mergedStates, outerState));
            }
        }

        function popNamedLabel(name: Identifier, outerState: T): void {
            Debug.assert(hasProperty(labels, name.text));
            var index = labels[name.text];
            Debug.assert(labelStack.length === index + 1);
            labels[name.text] = undefined;
            var mergedStates = labelStack.pop();
            setFinalStateAtLabel(mergedStates, outerState, name);
        }

        function popImplicitLabel(index: number, outerState: T): void {
            Debug.assert(labelStack.length === index + 1);
            var i = implicitLabels.pop();
            Debug.assert(index === i);
            var mergedStates = labelStack.pop();
            setFinalStateAtLabel(mergedStates, outerState, /*name*/ undefined);
        }

        function gotoLabel(label: Identifier, outerState: T): void {
            var stateIndex: number;
            if (label) {
                if (!hasProperty(labels, label.text)) {
                    // reference to non-existing label
                    return;
                }
                stateIndex = labels[label.text];
            }
            else {
                if (implicitLabels.length === 0) {
                    // non-labeled break\continue being used outside loops
                    return;
                }

                stateIndex = implicitLabels[implicitLabels.length - 1];
            }
            var stateAtLabel = labelStack[stateIndex];
            labelStack[stateIndex] = env.isUninitialized(stateAtLabel) ? outerState : env.or(outerState, stateAtLabel);
        }

        function checkWhileStatement(n: WhileStatement): void {
            var preWhileState: T = n.expression.kind === SyntaxKind.FalseKeyword ? env.unreachable() : state.state;
            var postWhileState: T = n.expression.kind === SyntaxKind.TrueKeyword ? env.unreachable() : state.state;

            setState(preWhileState);

            var index = pushImplicitLabel();
            walker(n.statement, state, check);
            popImplicitLabel(index, postWhileState);
        }

        function checkDoStatement(n: DoStatement): void {
            var preDoState = state.state;

            var index = pushImplicitLabel();
            walker(n.statement, state, check);

            var postDoState = n.expression.kind === SyntaxKind.TrueKeyword ? env.unreachable() : preDoState;
            popImplicitLabel(index, postDoState);
        }

        function checkForStatement(n: ForStatement): void {
            var preForState = state.state;
            var index = pushImplicitLabel();
            walker(n.statement, state, check);
            var postForState = n.declarations || n.initializer || n.condition || n.iterator ? preForState : env.unreachable();
            popImplicitLabel(index, postForState);
        }

        function checkForInStatement(n: ForInStatement): void {
            var preForInState = state.state;
            var index = pushImplicitLabel();
            walker(n.statement, state, check);
            popImplicitLabel(index, preForInState);
        }

        function checkBlock(n: Block): void {
            forEach(n.statements, check);
        }

        function checkIfStatement(n: IfStatement): void {
            var ifTrueState: T = n.expression.kind === SyntaxKind.FalseKeyword ? env.unreachable() : state.state;
            var ifFalseState: T = n.expression.kind === SyntaxKind.TrueKeyword ? env.unreachable() : state.state;

            setState(ifTrueState);
            walker(n.thenStatement, state, check);
            ifTrueState = state.state;

            setState(ifFalseState);
            walker(n.elseStatement, state, check);

            setState(env.or(state.state, ifTrueState));
        }

        function checkReturnOrThrow(n: Node): void {
            setState(env.unreachable());
        }

        function checkBreakOrContinueStatement(n: BreakOrContinueStatement): void {
            if (n.kind === SyntaxKind.BreakStatement) {
                gotoLabel(n.label, state.state);
            }
            else {
                gotoLabel(n.label, env.unreachable()); // touch label so it will be marked a used
            }
            setState(env.unreachable());
        }

        function checkTryStatement(n: TryStatement): void {

            // catch\finally blocks has the same reachability as try block
            var startState = state.state;
            walker(n.tryBlock, state, check);
            var postTryState = state.state;

            setState(startState);
            walker(n.catchBlock, state, check);
            var postCatchState = state.state;

            setState(startState);
            walker(n.finallyBlock, state, check);
            setState(env.or(postTryState, postCatchState));
        }

        function checkSwitchStatement(n: SwitchStatement): void {
            var startState = state.state;
            var hasDefault = false;

            var index = pushImplicitLabel();

            forEach(n.clauses, (c: CaseOrDefaultClause) => {
                hasDefault = hasDefault || c.kind === SyntaxKind.DefaultClause;
                setState(env.copy(startState));
                forEach(c.statements, s => walker(s, state, check));
            });

            // post switch state is unreachable if switch is exaustive (has a default case ) and does not have fallthrough from the last case
            var postSwitchState = hasDefault && !env.isReachable(state.state) ? env.unreachable() : startState;

            popImplicitLabel(index, postSwitchState);
        }

        function checkLabelledStatement(n: LabelledStatement): void {
            var ok = pushNamedLabel(n.label);
            walker(n.statement, state, check);
            if (ok) {
                popNamedLabel(n.label, env.copy(state.state));
            }
        }

        function checkWithStatement(n: WithStatement): void {
            check(n.statement);
        }

        // current assumption: only statements affect CF
        function check(n: Node): void {
            if (!n) {
                return;
            }
            switch (n.kind) {
                case SyntaxKind.WhileStatement:
                    checkWhileStatement(<WhileStatement>n);
                    break;
                case SyntaxKind.SourceFile:
                    checkBlock(<SourceFile>n);
                    break;
                case SyntaxKind.Block:
                case SyntaxKind.TryBlock:
                case SyntaxKind.CatchBlock:
                case SyntaxKind.FinallyBlock:
                case SyntaxKind.ModuleBlock:
                case SyntaxKind.FunctionBlock:
                    checkBlock(<Block>n);
                    break;
                case SyntaxKind.IfStatement:
                    checkIfStatement(<IfStatement>n);
                    break;
                case SyntaxKind.ReturnStatement:
                case SyntaxKind.ThrowStatement:
                    checkReturnOrThrow(n);
                    break;
                case SyntaxKind.BreakStatement:
                case SyntaxKind.ContinueStatement:
                    checkBreakOrContinueStatement(<BreakOrContinueStatement>n);
                    break;
                case SyntaxKind.DoStatement:
                    checkDoStatement(<DoStatement>n);
                    break;
                case SyntaxKind.ForInStatement:
                    checkForInStatement(<ForInStatement>n);
                    break;
                case SyntaxKind.ForStatement:
                    checkForStatement(<ForStatement>n);
                    break;
                case SyntaxKind.LabelledStatement:
                    checkLabelledStatement(<LabelledStatement>n);
                    break;
                case SyntaxKind.SwitchStatement:
                    checkSwitchStatement(<SwitchStatement>n);
                    break;
                case SyntaxKind.TryStatement:
                    checkTryStatement(<TryStatement>n);
                    break;
                case SyntaxKind.WithStatement:
                    checkWithStatement(<WithStatement>n);
                default:
                    forEachChild(n, c => walker(c, state, check));
                    break;
            }
        }
    }
}