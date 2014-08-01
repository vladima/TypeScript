/// <reference path="types.ts"/>
/// <reference path="core.ts"/>
/// <reference path="scanner.ts"/>
/// <reference path="parser.ts"/>
/// <reference path="binder.ts"/>

module ts {
    export function checkFlow(decl: FunctionDeclaration, noImplicitReturns: boolean, error: (n: Node, message: DiagnosticMessage, arg0?: any) => void) {
        if (!decl.body) {
            return;
        }

        var finalState = checkControlFlow(decl, error);
        if (noImplicitReturns && finalState === ControlFlowState.Reachable) {
            var errorNode: Node = decl.name || decl;
            error(errorNode, Diagnostics.Not_all_code_paths_return_a_value);
        }
    }

    function checkControlFlow(decl: FunctionDeclaration, error: (n: Node, message: DiagnosticMessage, arg0?: any) => void): ControlFlowState {
        var state = ControlFlowState.Reachable;
        var trueState = ControlFlowState.Default;
        var falseState = ControlFlowState.Default;
        var isInSplit = false;

        function setState(newState: ControlFlowState) {
            trueState = falseState = ControlFlowState.Default;
            state = newState;
            isInSplit = false;
        }

        function setSplitState(newTrue: ControlFlowState, newFalse: ControlFlowState) {
            trueState = newTrue;
            falseState = newFalse;
            state = ControlFlowState.Default;
            isInSplit = true;
        }

        function split() {
            if (!isInSplit) {
                setSplitState(state, state);
            }
        }

        function join() {
            if (isInSplit) {
                setState(or(trueState, falseState));
                isInSplit = false;
            }
        }

        function or(s1: ControlFlowState, s2: ControlFlowState): ControlFlowState {
            if (s1 === ControlFlowState.Reachable || s2 === ControlFlowState.Reachable) {
                return ControlFlowState.Reachable;
            }
            if (s1 === ControlFlowState.ReportedUnreachable && s2 === ControlFlowState.ReportedUnreachable) {
                return ControlFlowState.ReportedUnreachable;
            }
            return ControlFlowState.Unreachable;
        }

        function and(s1: ControlFlowState, s2: ControlFlowState): ControlFlowState {
            if (s1 === ControlFlowState.Reachable && s2 === ControlFlowState.Reachable) {
                return ControlFlowState.Reachable;
            }
            if (s1 === ControlFlowState.ReportedUnreachable && s2 === ControlFlowState.ReportedUnreachable) {
                return ControlFlowState.ReportedUnreachable;
            }
            return ControlFlowState.Unreachable;
        }

        function verifyReachable(n: Node): void {
            if (state === ControlFlowState.Unreachable) {
                error(n, Diagnostics.Unreachable_code_detected);
                state = ControlFlowState.ReportedUnreachable;
            }
        }

        function enterCondition(n: Node) {
            if (n.kind === SyntaxKind.TrueKeyword) {
                join();
                setSplitState(state, ControlFlowState.Unreachable);
            }
            else if (n.kind === SyntaxKind.FalseKeyword) {
                join();
                setSplitState(ControlFlowState.Unreachable, state);
            }
            else {
                split();
            }
        }

        var loopState: ControlFlowState[] = [];
        var implicitBreaks: ControlFlowState[] = [];

        function checkWhileStatement(n: WhileStatement): void {
            var size = loopState.length;
            loopState.push(state);



            loopState.pop();
            Debug.assert(loopState.length === size);
        }

        function checkDoStatement(n: DoStatement): void {
            verifyReachable(n);
            check((<DoStatement>n).statement);
        }

        function checkForStatement(n: ForStatement): void {
            verifyReachable(n);
            check((<ForStatement>n).statement);
        }

        function checkForInStatement(n: ForInStatement): void {
            verifyReachable(n);
            check((<ForInStatement>n).statement);
        }

        function checkBlock(n: Block): void {
            forEach(n.statements, check);
        }

        function checkIfStatement(n: IfStatement): void {
            enterCondition((<IfStatement>n).expression);
            var savedTrue = trueState;
            var savedFalse = falseState;

            setState(savedTrue);
            check((<IfStatement>n).thenStatement);
            savedTrue = state;

            setState(savedFalse);
            check((<IfStatement>n).elseStatement);

            state = or(state, savedTrue);
        }

        function checkReturnOrThrow(n: Node): void {
            verifyReachable(n);
            setState(ControlFlowState.Unreachable);
        }

        function checkBreakOrContinueStatement(n: BreakOrContinueStatement): void {
            verifyReachable(n);
            var currentState = state;
            setState(ControlFlowState.Unreachable);
            if (n.label) {
                // TODO
            }
            else {
                if (n.kind === SyntaxKind.BreakStatement) {
                    // simulate jump to a implicit label
                    var implicitBreakState = implicitBreaks[implicitBreaks.length - 1];
                    implicitBreaks[implicitBreaks.length - 1] = implicitBreakState === ControlFlowState.Uninitialized ? currentState : or(implicitBreakState, currentState);
                }
            }
        }

        function checkTryStatement(n: TryStatement): void {
            verifyReachable(n);
            check(n.tryBlock);
            check(n.catchBlock);
            check(n.finallyBlock);
        }

        function checkSwitchStatement(n: SwitchStatement): void {
            verifyReachable(n);
            var startState = state;
            var hasDefault = false;

            implicitBreaks.push(ControlFlowState.Uninitialized);

            forEach(n.clauses, (c: CaseOrDefaultClause) => {
                hasDefault = hasDefault || c.kind === SyntaxKind.DefaultClause;
                setState(startState);
                forEach(c.statements, check);
            });

            // post switch state is unreachable if switch is exaustive (has a default case ) and does not have fallthrough from the last case
            var finalState = hasDefault && state !== ControlFlowState.Reachable ? ControlFlowState.Unreachable : startState;

            var mergedBreakState = implicitBreaks.pop();
            setState(mergedBreakState === ControlFlowState.Uninitialized ? finalState : or(mergedBreakState, finalState));
        }

        function checkLabelledStatement(n: LabelledStatement): void {
            verifyReachable(n);
            check(n.statement);
        }

        function checkWithStatement(n: WithStatement): void {
            verifyReachable(n);
            check(n.statement);
        }

        // current assumption: only statements affect CF
        function check(n: Node): void {
            if (!n || state === ControlFlowState.ReportedUnreachable) {
                return;
            }
            switch (n.kind) {
                case SyntaxKind.WhileStatement:
                    checkWhileStatement(<WhileStatement>n);
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
                case SyntaxKind.VariableStatement:
                case SyntaxKind.EmptyStatement:
                case SyntaxKind.ExpressionStatement:
                case SyntaxKind.DebuggerStatement:
                    verifyReachable(n);
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
                    break;
            }
        }

        check(decl.body);
        return state;
    }

    enum ControlFlowState {
        Uninitialized       = 0,
        Reachable           = 1,
        Unreachable         = 2,
        ReportedUnreachable = Unreachable | 4,
        Default             = Unreachable
    }
}