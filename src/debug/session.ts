import {
	LoggingDebugSession,
	InitializedEvent,
	TerminatedEvent,
	StoppedEvent,
	OutputEvent,
	Thread,
	Breakpoint,
	BreakpointEvent,
	Source,
	StackFrame
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { Interpreter, CustomType, Debugger, OperationContext, ContextType } from 'greybel-interpreter';
import { InterpreterResourceProvider } from '../resource';
import { init as initIntrinsics } from 'greybel-intrinsics';
import path from 'path';

interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	program: string;
	noDebug?: boolean;
}

interface IRuntimeStackFrame {
	index: number;
	name: string;
	file: string;
	line: number;
	column?: number;
}

interface IRuntimeStack {
	count: number;
	frames: IRuntimeStackFrame[];
}

export class GreybelDebugSession extends LoggingDebugSession {
	public static threadID = 1;
	public lastContext: OperationContext | undefined;
	public breakpoints: Map<string, DebugProtocol.Breakpoint[]> = new Map();

	private _runtime: Interpreter;
	private _breakpointIncrement: number = 0;

	public constructor() {
		super("greybel-debug.txt");

		// this debugger uses zero-based lines and columns
		const me = this;
		const vsAPI = new Map();

		vsAPI.set('print', (customValue: CustomType): void => {
            const e: DebugProtocol.OutputEvent = new OutputEvent(`${customValue.toString()}\n`);
			me.sendEvent(e);
        });

		me.setDebuggerLinesStartAt1(false);
		me.setDebuggerColumnsStartAt1(false);

		this._runtime = new Interpreter({
            resourceHandler: new InterpreterResourceProvider().getHandler(),
			debugger: new GrebyelDebugger(me),
			api: initIntrinsics(vsAPI)
		});
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDone request.
		response.body.supportsConfigurationDoneRequest = false;

		// make VS Code use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = false;

		// make VS Code show a 'step back' button
		response.body.supportsStepBack = false;

		// make VS Code support data breakpoints
		response.body.supportsDataBreakpoints = false;

		// make VS Code support completion in REPL
		response.body.supportsCompletionsRequest = false;
		response.body.completionTriggerCharacters = [ ".", "[" ];

		// make VS Code send cancel request
		response.body.supportsCancelRequest = false;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = true;

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = false;

		// the adapter defines two exceptions filters, one with support for conditions.
		response.body.supportsExceptionFilterOptions = false;
		response.body.exceptionBreakpointFilters = [];

		// make VS Code send exceptionInfo request
		response.body.supportsExceptionInfoRequest = false;

		// make VS Code send setVariable request
		response.body.supportsSetVariable = false;

		// make VS Code send setExpression request
		response.body.supportsSetExpression = false;

		// make VS Code send disassemble request
		response.body.supportsDisassembleRequest = false;
		response.body.supportsSteppingGranularity = false;
		response.body.supportsInstructionBreakpoints = false;

		// make VS Code able to read and write variable memory
		response.body.supportsReadMemoryRequest = false;
		response.body.supportsWriteMemoryRequest = false;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
		const me = this;
		
		me._runtime.setTarget(args.program);
		me._runtime.setDebugger(
			args.noDebug 
				? new GrebyelPseudoDebugger()
				: new GrebyelDebugger(me)
		);

		// start the program in the runtime
		try {
			await me._runtime.digest();
			me.sendResponse(response);
		} catch (err: any) {
			me.sendErrorResponse(response, {
				id: 1001,
				format: err.message,
				showUser: true
			});
		}

		me.sendEvent(new TerminatedEvent());
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(GreybelDebugSession.threadID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._runtime.debugger.setBreakpoint(false);
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this._runtime.debugger.next();
		this.sendResponse(response);
	}

	protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): Promise<void> {
		this._runtime.debugger.setBreakpoint(false);

		try {
			await this._runtime.exit();
		} catch (err: any) {
			console.warn(err.message);
		}

		this.sendResponse(response);
		this.shutdown();
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
		try {
			await this._runtime.injectInLastContext(args.expression);

			response.body = {
				result: `Execution of ${args.expression} was successful.`,
				variablesReference: 0
			};
		} catch (err: any) {
			response.body = {
				result: err.toString(),
				variablesReference: 0
			};
		}

		this.sendResponse(response);
	}

	public getStack(): IRuntimeStack {
		const me = this;
		const frames: IRuntimeStackFrame[] = [];
		const last = me._runtime.apiContext.getLastActive();
		let index = 0;
		let current = last;

		while (current && current.stackItem) {
			const stackItem = current.stackItem;
			const stackFrame: IRuntimeStackFrame = {
				index: index++,
				name: stackItem.type,	// use a word of the line as the stackframe name
				file: current.target,
				line: stackItem.start.line,
				column: stackItem.start.character
			};

			frames.push(stackFrame);
			current = current.previous;
		}

		return {
			frames: frames,
			count: frames.length
		};
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		const me = this;
		const stk = me.getStack();

		response.body = {
			stackFrames: stk.frames.map((f, ix) => {
				const sf: DebugProtocol.StackFrame = new StackFrame(
					f.index,
					f.name,
					new Source(path.basename(f.file), f.file),
					f.line,
					f.column
				);

				return sf;
			}),
			// 4 options for 'totalFrames':
			//omit totalFrames property: 	// VS Code has to probe/guess. Should result in a max. of two requests
			totalFrames: stk.count			// stk.count is the correct size, should result in a max. of two requests
			//totalFrames: 1000000 			// not the correct size, should result in a max. of two requests
			//totalFrames: endFrame + 20 	// dynamically increases the size with every requested chunk, results in paging
		};
		this.sendResponse(response);
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		const me = this;
		const path = args.source.path as string;
		const clientLines = args.lines || [];

		const actualBreakpoints0 = clientLines.map((line: number) => {
			const bp = new Breakpoint(
				false,
				line,
				0,
				new Source(path, path)
			) as DebugProtocol.Breakpoint;
			bp.id= me._breakpointIncrement++;
			return bp;
		});
		const actualBreakpoints = await Promise.all<DebugProtocol.Breakpoint>(actualBreakpoints0);

		me.breakpoints.set(path, actualBreakpoints);

		response.body = {
			breakpoints: actualBreakpoints
		};

		this.sendResponse(response);
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
		if (args.source.path) {
			const breakpoints = this.breakpoints.get(args.source.path) || [];
			const actualBreakpoint = breakpoints.find((bp: DebugProtocol.Breakpoint) => {
				return bp.line === args.line;
			}) as DebugProtocol.Breakpoint;

			if (actualBreakpoint) {
				response.body = {
					breakpoints: [{
						line: args.line
					}]
				};

				this.sendResponse(response);
				return;
			}
		}

		response.body = {
			breakpoints: []
		};

		this.sendResponse(response);
	}
}

class GrebyelDebugger extends Debugger {
	session: GreybelDebugSession;

	constructor(session: GreybelDebugSession) {
		super();
		this.session = session;
	}

	getBreakpoint(operationContext: OperationContext): boolean {
		const breakpoints = this.session.breakpoints.get(operationContext.target) || [];
		const actualBreakpoint = breakpoints.find((bp: DebugProtocol.Breakpoint) => {
			return bp.line === operationContext.stackItem?.start.line;
		}) as DebugProtocol.Breakpoint;

		if (actualBreakpoint) {
			actualBreakpoint.verified = true;
			this.session.sendEvent(new BreakpointEvent('changed', actualBreakpoint));
			this.breakpoint = true;
		}

		return this.breakpoint;
	}

	interact(operationContext: OperationContext) {
		this.session.lastContext = operationContext;
		this.session.sendEvent(new StoppedEvent('breakpoint', GreybelDebugSession.threadID));
	}
}

class GrebyelPseudoDebugger extends Debugger {
	getBreakpoint(operationContext: OperationContext): boolean {
		return false;
	}

	interact(operationContext: OperationContext) {
	}
}