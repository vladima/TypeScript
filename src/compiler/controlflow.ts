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
        var currentState = ControlFlowState.Reachable;
        var trueState = ControlFlowState.Default;
        var falseState = ControlFlowState.Default;
        var isInSplit = false;

        function setState(newState: ControlFlowState) {
            trueState = falseState = ControlFlowState.Default;
            currentState = newState;
            isInSplit = false;
        }

        function setSplitState(newTrue: ControlFlowState, newFalse: ControlFlowState) {
            trueState = newTrue;
            falseState = newFalse;
            currentState = ControlFlowState.Default;
            isInSplit = true;
        }

        function split() {
            if (!isInSplit) {
                setSplitState(currentState, currentState);
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
            if (currentState === ControlFlowState.Unreachable) {
                error(n, Diagnostics.Unreachable_code_detected);
                currentState = ControlFlowState.ReportedUnreachable;
            }
        }

        function enterCondition(n: Node) {
            if (n.kind === SyntaxKind.TrueKeyword) {
                join();
                setSplitState(currentState, ControlFlowState.Unreachable);
            }
            else if (n.kind === SyntaxKind.FalseKeyword) {
                join();
                setSplitState(ControlFlowState.Unreachable, currentState);
            }
            else {
                split();
            }
        }

        // label name -> index in 'labelStack'
        var labels: Map<number> = {};
        // CF state at all seen labels
        var labelStack: ControlFlowState[] = [];
        // indices of implicit labels in 'labelStack'
        var implicitLabels: number[] = [];

        function pushNamedLabel(name: Identifier): void {
            Debug.assert(!hasProperty(labels, name.text));
            var newLen = labelStack.push(ControlFlowState.Uninitialized);
            labels[name.text] = newLen - 1;
        }

        function pushImplicitLabel(): number {
            var newLen = labelStack.push(ControlFlowState.Uninitialized);
            implicitLabels.push(newLen - 1);
            return newLen - 1;
        }

        function setFinalStateAtLabel(mergedStates: ControlFlowState, outerState: ControlFlowState, name: Identifier): void {
            if (mergedStates === ControlFlowState.Uninitialized) {
                if (name) {
                    error(name, Diagnostics.Unused_label);
                }
                setState(outerState);
            }
            else {
                setState(or(mergedStates, outerState));
            }
        }

        function popNamedLabel(name: Identifier, outerState: ControlFlowState): void {
            Debug.assert(hasProperty(labels, name.text));
            var index = labels[name.text];
            Debug.assert(labelStack.length === index + 1);
            var mergedStates = labelStack.pop();
            setFinalStateAtLabel(mergedStates, outerState, name);
        }

        function popImplicitLabel(index: number, outerState: ControlFlowState): void {
            Debug.assert(labelStack.length === index + 1);
            var mergedStates = labelStack.pop();
            setFinalStateAtLabel(mergedStates, outerState, /*name*/ undefined);
        }

        function breakToLabel(label: Identifier): void {
            var stateIndex: number;
            if (label) {
                Debug.assert(hasProperty(labels, label.text));
                stateIndex = labels[label.text];
            }
            else {
                Debug.assert(implicitLabels.length > 0);
                stateIndex = implicitLabels[implicitLabels.length - 1];
            }
            var stateAtLabel = labelStack[stateIndex];
            labelStack[stateIndex] = stateAtLabel === ControlFlowState.Uninitialized ? currentState : or(currentState, stateAtLabel);
        }

        function checkWhileStatement(n: WhileStatement): void {
            verifyReachable(n);

            enterCondition(n.expression);
            var savedTrue = trueState;
            var savedFalse = falseState;
            setState(savedTrue);

            var index = pushImplicitLabel();
            check(n.statement);
            popImplicitLabel(index, savedFalse);
        }

        function checkDoStatement(n: DoStatement): void {
            verifyReachable(n);
            check((<DoStatement>n).statement);
        }

        function checkForStatement(n: ForStatement): void {
            verifyReachable(n);

            var savedState = currentState;
            if (!n.declarations && !n.initializer && !n.condition && !n.iterator) {
                savedState = ControlFlowState.Unreachable;
            }

            var index = pushImplicitLabel();
            check(n.statement);
            popImplicitLabel(index, savedState);
        }

        function checkForInStatement(n: ForInStatement): void {
            verifyReachable(n);
            check(n.statement);
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
            savedTrue = currentState;

            setState(savedFalse);
            check((<IfStatement>n).elseStatement);

            currentState = or(currentState, savedTrue);
        }

        function checkReturnOrThrow(n: Node): void {
            verifyReachable(n);
            setState(ControlFlowState.Unreachable);
        }

        function checkBreakOrContinueStatement(n: BreakOrContinueStatement): void {
            verifyReachable(n);
            var currentState = currentState;
            setState(ControlFlowState.Unreachable);
            // continue does not affect subsequent CF so just ignore them 
            if (n.kind === SyntaxKind.BreakStatement) {
                breakToLabel(n.label);
            } 
        }

        function checkTryStatement(n: TryStatement): void {
            verifyReachable(n);

            // catch\finally blocks has the same reachability as try block
            var startState = currentState;
            check(n.tryBlock);

            setState(startState);
            check(n.catchBlock);

            setState(startState);
            check(n.finallyBlock);
        }

        function checkSwitchStatement(n: SwitchStatement): void {
            verifyReachable(n);
            var startState = currentState;
            var hasDefault = false;

            var index = pushImplicitLabel();

            forEach(n.clauses, (c: CaseOrDefaultClause) => {
                hasDefault = hasDefault || c.kind === SyntaxKind.DefaultClause;
                setState(startState);
                forEach(c.statements, check);
            });

            // post switch state is unreachable if switch is exaustive (has a default case ) and does not have fallthrough from the last case
            var afterSwitchState = hasDefault && currentState !== ControlFlowState.Reachable ? ControlFlowState.Unreachable : startState;

            popImplicitLabel(index, afterSwitchState);
        }

        function checkLabelledStatement(n: LabelledStatement): void {
            verifyReachable(n);
            pushNamedLabel(n.label);
            check(n.statement);
            popNamedLabel(n.label, currentState);
        }

        function checkWithStatement(n: WithStatement): void {
            verifyReachable(n);
            check(n.statement);
        }

        // current assumption: only statements affect CF
        function check(n: Node): void {
            if (!n || currentState === ControlFlowState.ReportedUnreachable) {
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
        return currentState;
    }

    enum ControlFlowState {
        Uninitialized       = 0,
        Reachable           = 1,
        Unreachable         = 2,
        ReportedUnreachable = 3,
        Default             = Unreachable
    }
}