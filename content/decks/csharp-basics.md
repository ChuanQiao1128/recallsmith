# deck: csharp-basics

## net-types-01 | d1
TOPIC: 1.1 Types and Memory
Q:
A method takes a `List<int>` parameter with no modifier and calls `Add(4)` on it. After the call, does the caller's list contain 4, and why?
A:
Yes. The method receives a copy of the reference, and both copies point to the same list object on the heap, so `Add` mutates the single list the caller also holds.
USAGE:
Say "the reference is passed by value": the object is shared, only the variable is copied.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/method-parameters
When you pass a reference type by value to a method, the method gets a copy of the reference to the instance. Both variables refer to the same object. The parameter is a copy of the reference.

## net-types-02 | d1
TOPIC: 1.1 Types and Memory
Q:
What does this program print?
```csharp
string a = "cat";
string b = a;
a += "s";
Console.WriteLine($"{a} {b}");
```
A:
It prints `cats cat`. Strings are immutable, so `+=` builds a new string and points `a` at it, while `b` still refers to the original "cat" object.
USAGE:
The same rule explains why string methods such as `Replace` or `ToUpper` return a result you must assign.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/strings/
Because a string "modification" is actually a new string creation, you must use caution when you create references to strings. If you create a reference to a string, and then "modify" the original string, the reference continues to point to the original object.

## net-types-03 | d1
TOPIC: 1.1 Types and Memory
Q:
Why should a product price be stored as a `decimal` rather than a `double`, and what goes wrong with `double`?
A:
Because `decimal` represents base-10 amounts such as 0.10 exactly, while `double` is binary floating point and cannot represent 0.1. With `double`, sums drift (`0.1 + 0.2 == 0.3` is false), so totals and comparisons can be off by a cent.
USAGE:
Remember the `m` suffix (`19.99m`); use `double` only when speed or range matters more than exact decimal digits.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/floating-point-numeric-types
Even numbers that are precise to only one decimal digit are handled more accurately by the decimal type: 0.1, for example, can be exactly represented by a decimal instance, while there's no double or float instance that exactly represents 0.1. Because of this difference in numeric types, unexpected rounding errors can occur in arithmetic calculations when you use double or float for decimal data.

## net-types-04 | d1
TOPIC: 1.1 Types and Memory
Q:
What does this program print, and why?
```csharp
var items = new List<int> { 1, 2, 3 };
Reset(ref items);
Console.WriteLine(items.Count);
static void Reset(ref List<int> list) => list = new List<int>();
```
A:
It prints `0`. With `ref`, the parameter is an alias for the caller's `items` variable, so assigning a new list replaces what `items` refers to; the original three-item list is simply abandoned.
USAGE:
Use `ref` only when the method must replace the caller's variable; returning the new value is usually clearer.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/method-parameters
The preceding example shows how reassigning the value of a parameter that is passed by reference is visible in the calling context.

## net-types-05 | d1
TOPIC: 1.1 Types and Memory
Q:
An optional database column maps to `int? discount`, which is null for some rows, and the code does `int d = (int)discount;`. What happens at run time, and how do you write it safely?
A:
It throws `InvalidOperationException` ("Nullable object must have a value") because the explicit cast reads the value when `HasValue` is false. Decide what null means: `discount ?? 0` or `GetValueOrDefault()` for a default, or `if (discount is int d)` to branch.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/nullable-value-types
At run time, if the value of a nullable value type is null, the explicit cast throws an InvalidOperationException.

## net-types-06 | d1
TOPIC: 1.1 Types and Memory
Q:
A `TryParse`-style method must hand back its result through a variable that the caller declares but does not initialize. Which parameter modifier fits?
OPT: a
`ref`, so the method can overwrite the caller's variable
WHY:
`ref` requires the argument to be definitely assigned before the call, so passing an uninitialized local is a compile error.
OPT: b *
`out`, because the method must assign it before returning
OPT: c
`in`, so the variable is passed by reference without a copy
WHY:
`in` is a read-only reference: the method cannot assign it, and the caller must initialize the argument first.
OPT: d
`ref readonly`, so the caller's variable is shared but protected
WHY:
`ref readonly` is read-only inside the method, so it cannot carry a result back, and it expects an initialized variable.
A:
`out` fits: the caller may pass an unassigned variable, and the compiler forces the method to assign it on every return path, so the caller can read it afterward. That is the `bool TryParse(string s, out int value)` contract.
USAGE:
Call it as `int.TryParse(input, out var n)`: the declaration inline is idiomatic and avoids a dummy initial value.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/method-parameters
out: The calling method doesn't need to initialize the argument before calling the method. The method must assign a value to the parameter.

## net-types-07 | d1
TOPIC: 1.1 Types and Memory
Q:
Given `int i = 42;`, which statement boxes `i`, allocating an object on the managed heap?
OPT: a *
`IComparable c = i;`
OPT: b
`numbers.Add(i);` where `numbers` is a `List<int>`
WHY:
`List<int>` is generic and stores the values in an internal `int[]`, so no box is created; boxing happens with the non-generic `ArrayList`.
OPT: c
`long total = i + 1L;`
WHY:
An implicit numeric widening conversion produces a new `long` value; no heap object is involved.
OPT: d
`int? maybe = i;`
WHY:
`Nullable<int>` is itself a struct holding the value and a `HasValue` flag, so wrapping an `int` in it does not allocate.
A:
`IComparable c = i;` boxes: converting a value type to an interface it implements needs a reference, so the CLR copies the `int` into a new heap object. Passing structs as interfaces is where boxing hides.
USAGE:
In hot paths, prefer generic methods constrained to the interface (`where T : IComparable<T>`), which call the struct without boxing.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/types/boxing-and-unboxing
Boxing is the process of converting a value type to the type object or to any interface type implemented by this value type. When the common language runtime (CLR) boxes a value type, it wraps the value inside a System.Object instance and stores it on the managed heap.

## net-types-08 | d1
TOPIC: 1.1 Types and Memory
Q:
What happens with this code?
```csharp
var points = new List<Point> { new Point() };
points[0].X = 5;
Console.WriteLine(points[0].X);
struct Point { public int X; }
```
OPT: a
It prints 5, because the indexer updates the stored element
WHY:
That is how an array element behaves, because an array access is a variable; a `List<T>` indexer is a method that returns a copy of the struct.
OPT: b
It prints 0, because only a temporary copy is modified
WHY:
The compiler blocks this silent data loss: a change to a returned copy would be discarded, so it reports an error instead of compiling it.
OPT: c *
It fails to compile with error CS1612
OPT: d
It throws InvalidOperationException when the indexer is used
WHY:
Nothing runs: the problem is detected at compile time, and the `List<T>` indexer does not throw for a valid index.
A:
It fails to compile with CS1612: the `List<T>` indexer returns a copy of the `Point`, which is not a variable, so assigning its field would be lost. Copy the element, change it, and write it back (`var p = points[0]; p.X = 5; points[0] = p;`), or make the struct immutable.
USAGE:
Mutable structs in collections are a classic bug source; declaring them `readonly struct` makes the copy semantics explicit.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/cs1612
This error occurs because value types are copied on assignment. When you retrieve a value type from a property or indexer, you are getting a copy of the object, not a reference to the object itself.

## net-types-09 | d1
TOPIC: 1.1 Types and Memory
QUALIFIER: BEST
Q:
A report job builds a 20,000-line CSV with `csv += line;` inside a loop, and profiling shows heavy allocation. Which change is BEST?
OPT: a *
Append lines to a `StringBuilder`, then call `ToString` once
OPT: b
Pass each line through `string.Intern` before appending it
WHY:
Interning deduplicates identical strings, but each concatenation still copies the whole growing `csv` into a new string, so the cost is unchanged.
OPT: c
Use interpolation, `csv = $"{csv}{line}";`, inside the loop
WHY:
Interpolation still creates a brand-new string containing all previous text on every pass, so the copying stays quadratic.
OPT: d
Call `string.Concat(csv, line)` explicitly on each iteration
WHY:
String `+=` already compiles to `string.Concat`, so this is the same allocation and copy per iteration.
A:
Use a `StringBuilder`: it appends into a growable internal buffer, so each line is copied about once instead of re-copying all accumulated text into a new immutable string every iteration. Call `ToString` once at the end.
USAGE:
For a handful of fixed pieces, plain concatenation or interpolation is fine; `StringBuilder` pays off in loops.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/base-types/stringbuilder
In situations where you need to perform repeated modifications to a string, the overhead associated with creating a new String object can be costly. The System.Text.StringBuilder class can be used when you want to modify a string without creating a new object.

## net-types-10 | d2
TOPIC: 1.1 Types and Memory
Q:
A candidate says "structs live on the stack and classes on the heap." Where does an `int` field of a class instance actually live, and where do the elements of a `Point[]` array live, where `Point` is a struct?
A:
Both are on the heap, because a value type lives inline wherever its container lives. The `int` field sits inside the class instance, and `Point[]` elements sit inline in the array object. Locals and parameters usually live on the stack, but even they move to the heap when captured by a lambda or held across an `await`. So the real difference is copy-on-assignment semantics, not location.
USAGE:
In an interview, correct the myth politely, then pivot to what matters: value types copy on assignment, reference types share.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/choosing-between-class-and-struct
The first difference between reference types and value types we will consider is that reference types are allocated on the heap and garbage-collected, whereas value types are allocated either on the stack or inline in containing types and deallocated when the stack unwinds or when their containing type gets deallocated.

## net-types-11 | d2
TOPIC: 1.1 Types and Memory
Q:
A `Customer` class overrides `Equals` to compare `Id` but does not override `GetHashCode`. Looking up a new `Customer` with the same `Id` in a `Dictionary<Customer, Order>` finds nothing. Why, and what is the contract?
A:
Because `Dictionary` picks a bucket by hash code before calling `Equals`, and the inherited identity-based `GetHashCode` gives the two instances different codes. So the lookup searches the wrong bucket and `Equals` is not even called. The contract: equal objects must return the same hash code, so derive it from the fields `Equals` uses (`HashCode.Combine(Id)`) and keep them unchanged while the object is a key.
USAGE:
The compiler warns (CS0659) when you override `Equals` alone; records generate both members for you.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.object.gethashcode?view=net-8.0
If you override the GetHashCode method, you should also override Equals, and vice versa. If your overridden Equals method returns true when two objects are tested for equality, your overridden GetHashCode method must return the same value for the two objects.

## net-types-12 | d2
TOPIC: 1.1 Types and Memory
Q:
Why does this class not compile, and what do you store in the field instead when the buffer must outlive a single method call?
```csharp
class Parser
{
    private Span<byte> _buffer;
}
```
A:
`Span<T>` is a `ref struct`, which must stay on the stack, and a class field lives on the heap, so the compiler rejects the field with CS8345. A span may point at stack memory (`stackalloc`), and that reference must not outlive its frame. Store a `Memory<byte>` (or the `byte[]`) in the field instead and call `.Span` inside each synchronous method that processes it.
USAGE:
The same rule blocks spans in lambdas and across `await`; `Memory<T>` is the heap-safe handle you keep.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct
You can't declare a ref struct as the type of a field in a class or a non-ref struct.

## net-types-13 | d2
TOPIC: 1.1 Types and Memory
Q:
Library v1 declares `public const int MaxRetries = 3;`. In v2 it becomes 5, and only the library DLL is redeployed; the app that reads `MaxRetries` is not recompiled. What value does the app use?
OPT: a
5, because the app loads the new library DLL at run time
WHY:
The app never reads the field from the library: the literal 3 was compiled into its own IL, so the new DLL's value is not consulted.
OPT: b *
3, because the compiler copied the value into the app's IL
OPT: c
A MissingFieldException is thrown when the field is first read
WHY:
The field still exists in v2, and the app does not access it at run time anyway because it holds the literal, so nothing fails to bind.
OPT: d
5 in Release builds, and 3 in Debug builds where constants are not inlined
WHY:
Constant substitution is done by the C# compiler in every configuration, not by the optimizer or the JIT, so both builds embed 3.
A:
3: the compiler substitutes a `const` value at every use site, including in other assemblies, so the app carries the literal 3 until it is recompiled. Expose values that may change as `public static readonly`, which callers read from the library at run time.
USAGE:
Keep `public const` for true constants such as protocol limits; versioned settings belong in `static readonly` fields or configuration.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/const
These values can change over time, and because compilers propagate constants, other code compiled with your libraries needs to be recompiled to see the changes.

## net-types-14 | d2
TOPIC: 1.1 Types and Memory
Q:
A hot path declares `double Area(in BigShape s)` to avoid copying a large struct. A caller writes `Area(GetShape())`, without `in` at the call site. What does the compiler pass?
OPT: a *
A readonly reference to a compiler-created temporary copy
OPT: b
Nothing: it reports an error because `in` arguments must be variables
WHY:
Only an explicit `in` at the call site requires a variable; without it, the compiler accepts any value and materializes a temporary for it.
OPT: c
The struct by value, since `in` is only an optimization hint to the JIT
WHY:
`in` is a language-level by-reference contract, not a hint: the method receives a reference, so the compiler needs a location to point at.
OPT: d
A boxed copy on the heap, so the method can hold a stable reference
WHY:
`in` parameters do not box; the temporary is an ordinary local, and a box would be an `object`, not a reference to a `BigShape`.
A:
The compiler stores the returned value in a hidden temporary and passes a readonly reference to it. So the copy still happens for method results, literals and converted arguments; `in` at the call site makes the compiler reject them, and a `ref readonly` parameter makes it warn on a non-variable.
USAGE:
Measure before adding `in`: for small structs, passing a reference can cost more than the copy it saves.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/method-parameters
The in modifier enables the compiler to create a temporary variable for the argument and pass a readonly reference to that argument. The compiler always creates a temporary variable when the argument must be converted, when there's an implicit conversion from the argument type, or when the argument is a value that isn't a variable.

## net-oop-01 | d1
TOPIC: 1.2 OOP and Interfaces
Q:
A `Customer` class already derives from `Entity`, and it must also be comparable and auditable. Why model "comparable" and "auditable" as interfaces rather than as abstract base classes?
A:
Because a C# class can have only one direct base class, and `Entity` already takes that slot, while it can implement any number of interfaces. Interfaces also describe capabilities without an "is a" relationship, so unrelated types such as `Order` can share them too.
USAGE:
In an interview, say "single inheritance of classes, multiple inheritance of contracts."
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/inheritance
A class can implement multiple interfaces even though it can derive from only a single direct base class.

## net-oop-02 | d1
TOPIC: 1.2 OOP and Interfaces
Q:
These two constructors repeat the same initialization. How do you make one reuse the other instead of copying the code?
```csharp
public class Employee
{
    public string Name { get; }
    public int Salary { get; }
    public Employee(string name) { Name = name.Trim(); Salary = 30000; }
    public Employee(string name, int salary) { Name = name.Trim(); Salary = salary; }
}
```
A:
Chain them: `public Employee(string name) : this(name, 30000) { }`. The short constructor forwards to the full one, so the trimming and assignments live in one place. The chained constructor runs before the caller's body, so that body only adds what differs.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/using-constructors
A constructor can invoke another constructor in the same object by using the this keyword. Like base, this can be used with or without parameters, and any parameters in the constructor are available as parameters to this, or as part of an expression.

## net-oop-03 | d1
TOPIC: 1.2 OOP and Interfaces
Q:
Other teams may derive from your `PaymentProcessor`, but its overridden `Validate` method must not be overridden further down the hierarchy. How do you enforce that without sealing the whole class?
A:
Mark the override sealed: `public sealed override bool Validate(...)`. The class stays inheritable, but a subclass that tries to override `Validate` gets compiler error CS0239. `sealed` on a member is valid only together with `override`, because it ends a virtual chain that a base class started.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/sealed
You can also use the sealed modifier on a method or property that overrides a virtual method or property in a base class. By using this approach, you enable developers to derive classes from your class while preventing them from overriding specific virtual methods or properties.

## net-oop-04 | d1
TOPIC: 1.2 OOP and Interfaces
Q:
What does this program print?
```csharp
Base b = new Derived();
Console.WriteLine($"{b.Name()} {b.Kind()}");
class Base {
    public virtual string Name() => "Base";
    public string Kind() => "Base"; }
class Derived : Base {
    public override string Name() => "Derived";
    public new string Kind() => "Derived"; }
```
A:
It prints `Derived Base`. `Name` is virtual and overridden, so the call dispatches on the object's run-time type (`Derived`); `Kind` is only hidden with `new`, so the call binds to the variable's compile-time type (`Base`).
USAGE:
Bites when code holds a base-type reference: a `new` method in the subclass is silently skipped.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/polymorphism
When you use the new keyword, you're creating a method that hides the base class method rather than overriding it. This is different from virtual methods. With method hiding, the method that gets called depends on the compile-time type of the variable, not the run-time type of the object.

## net-oop-05 | d1
TOPIC: 1.2 OOP and Interfaces
Q:
Every report generator needs the same `_createdAt` and `_author` fields, set by one shared constructor. Why is an abstract base class a better fit here than an interface?
A:
Because an interface can't hold instance state: it can't declare instance fields or instance constructors, so every implementer would redeclare and initialize those fields itself. An abstract class declares the fields and a protected constructor once, and each derived generator inherits both.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/interface
Interfaces can't contain instance state. While static fields are now permitted, instance fields aren't permitted in interfaces. Instance auto-properties aren't supported in interfaces, as they would implicitly declare a hidden field.

## net-oop-06 | d1
TOPIC: 1.2 OOP and Interfaces
Q:
`OrderService` and `EmailSender` both inherit from a `LoggingBase` class only to reuse its `Log` method. What is wrong with that design, and what would you do instead?
A:
It misuses inheritance: an `OrderService` is not a kind of logger, yet it spends its only base-class slot and couples itself to `LoggingBase`. Instead, use composition: inject an `ILogger<OrderService>` through the constructor, so the class reuses logging by having a collaborator rather than by being one.
USAGE:
Rule of thumb to say out loud: inherit for "is a", compose for "has a" or "uses a".
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/inheritance
Conceptually, a derived class is a specialization of the base class. For example, if you have a base class Animal, you might have one derived class that is named Mammal and another derived class that is named Reptile. A Mammal is an Animal, and a Reptile is an Animal, but each derived class represents different specializations of the base class.

## net-oop-07 | d1
TOPIC: 1.2 OOP and Interfaces
QUALIFIER: BEST
Q:
A class implements `IControl` and `ISurface`, and both declare `void Paint()`. Painting must behave differently depending on which interface the caller uses. Which approach is BEST?
OPT: a *
Implement `void IControl.Paint()` and `void ISurface.Paint()` explicitly
OPT: b
Declare one public `Paint()` and check inside it which interface the caller used
WHY:
A single public `Paint()` becomes the implementation for both interfaces, and the method has no way to know which interface reference it was called through.
OPT: c
Add a second `Paint()` marked with the `new` modifier for `ISurface`
WHY:
`new` hides an inherited base-class member; it can't add a second `Paint()` with the same signature to one class, which is a duplicate-member error.
OPT: d
Add an overload `Paint(int mode)` that `ISurface` callers use
WHY:
An overload has a different signature, so it implements neither interface; `ISurface.Paint()` still maps to the same parameterless method as `IControl.Paint()`.
A:
Explicit implementations `IControl.Paint()` and `ISurface.Paint()` give each interface its own method body. Each is callable only through its interface reference, so the call site's interface type picks the behavior, and neither method appears on the class's public surface.
USAGE:
Also handy for hiding a member such as `IDisposable.Dispose` behind a domain-friendly public name like `Close`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/interfaces/explicit-interface-implementation
To call a different implementation depending on which interface is in use, you can implement an interface member explicitly. An explicit interface implementation is a class member that is only called through the specified interface.

## net-oop-08 | d1
TOPIC: 1.2 OOP and Interfaces
Q:
A library declares `class PriceCalculator { }` directly in a namespace, with no access modifier. A referencing app gets an error that `PriceCalculator` is inaccessible due to its protection level. Why?
OPT: a *
It defaults to internal, visible only inside the library assembly
OPT: b
It defaults to private, visible only inside the file that declares it
WHY:
A namespace-level class can't be private at all; restricting a type to one source file needs the explicit `file` modifier.
OPT: c
It defaults to protected, visible only to classes that derive from it
WHY:
`protected` isn't allowed on a type declared directly in a namespace; it applies only to members and nested types.
OPT: d
The app lacks a `using` directive for the library's namespace
WHY:
A missing `using` produces a "type or namespace not found" error, not an inaccessibility error; even a fully qualified name would still fail here.
A:
The class defaults to internal, so only code in the library's own assembly can use it. Declaring it `public` (or granting access with `InternalsVisibleTo`) lets the referencing app see it.
USAGE:
Bites when you split a project into a library: classes that compiled fine before become invisible to the app.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/access-modifiers
Classes and structs declared directly within a namespace (aren't nested within other classes or structs) can have public or internal access. If you don't specify an access modifier, the default is internal.

## net-oop-09 | d2
TOPIC: 1.2 OOP and Interfaces
Q:
Why does this not compile, and what is the minimal fix?
```csharp
var bot = new Bot();
Console.WriteLine(bot.Greet());
interface IGreeter { string Greet() => "Hi"; }
class Bot : IGreeter { }
```
A:
A default interface member is not inherited as a class member, so `bot.Greet()` fails with CS1061; the fix is `IGreeter bot = new Bot();`. The default `Greet` is reachable only through an `IGreeter` reference, because it never joins `Bot`'s public surface. That is deliberate: adding a default member to a published interface can't clash with or change existing class members.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/interfaces/explicit-interface-implementation
If a class inherits a method implementation from an interface, that method is only accessible through a reference of the interface type. The inherited member doesn't appear as part of the public interface.

## net-oop-10 | d2
TOPIC: 1.2 OOP and Interfaces
Q:
What does this program print?
```csharp
new Logger().Write("hi");
class Logger
{
    public void Write(object o) => Console.WriteLine("instance");
}
static class LoggerExtensions
{
    public static void Write(this Logger l, string s) => Console.WriteLine("extension");
}
```
A:
It prints `instance`. The compiler first looks for an applicable instance method; `Write(object)` accepts the string through an implicit conversion, so extension methods are never considered, even though `Write(string)` matches better. Consequence: adding an applicable instance method to a type silently redirects calls away from existing extension methods.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/extension-methods
When the compiler encounters a member invocation, it first looks for a match in the type's members. If no match is found, it searches for any extension members that are defined for the type.

## net-oop-11 | d2
TOPIC: 1.2 OOP and Interfaces
QUALIFIER: BEST
Q:
A public library base class has a helper that only its derived classes inside the library may call. Subclasses in customer assemblies must not. Which choice is BEST?
OPT: a *
private protected
OPT: b
protected internal
WHY:
`protected internal` is a union: derived classes in any assembly and every class in the library can call it, so customer subclasses still get access.
OPT: c
protected, plus `sealed` on every library subclass
WHY:
Sealing the library subclasses doesn't stop a customer from deriving from the public base class itself, where `protected` still grants access to the helper.
OPT: d
internal
WHY:
`internal` blocks customer assemblies, but every class in the library can call the helper, not just derived ones.
A:
`private protected` is an intersection: the caller must be in the same assembly and in the class or a derived class. Customer subclasses fail the assembly check, and non-derived library classes fail the inheritance check.
USAGE:
Mnemonic: protected internal means "or", private protected means "and".
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/access-modifiers
private protected: Only code in the same assembly and in the same class or a derived class can access the type or member.

## net-oop-12 | d2
TOPIC: 1.2 OOP and Interfaces
Q:
A class's static constructor reads a setting and throws on first use. An operator fixes the setting, and the running app touches the type again without restarting. What happens?
OPT: a *
It throws `TypeInitializationException` again without rerunning the static constructor
OPT: b
The static constructor runs again and succeeds with the corrected setting
WHY:
The runtime invokes a static constructor at most once per application domain, even when that attempt failed, so the fixed setting is never read.
OPT: c
The type works, but its static fields keep their default values
WHY:
A failed static constructor leaves the type uninitialized, and the runtime refuses further use of it instead of exposing default-valued fields.
OPT: d
It throws the constructor's original exception directly, unwrapped
WHY:
Exceptions escaping a static constructor surface wrapped in `TypeInitializationException`, with the original exception in `InnerException`, on the first access and every later one.
A:
It throws `TypeInitializationException` again: the runtime never reruns a failed static constructor, so the type stays unusable until the process restarts. That is why static constructors should not depend on configuration that can be wrong at startup.
USAGE:
In production this shows up as every request failing with the same TypeInitializationException until the app is recycled.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/static-constructors
If a static constructor throws an exception, the runtime doesn't invoke it a second time, and the type remains uninitialized for the lifetime of the application domain. Most commonly, a TypeInitializationException exception is thrown when a static constructor is unable to instantiate a type or for an unhandled exception occurring within a static constructor.

## net-null-01 | d1
TOPIC: 1.3 Nullability
Q:
A setting is read into `string? theme`, which may be null. How do you fall back to `LoadDefaultTheme()` in one expression, and when does that method actually run?
A:
Write `var t = theme ?? LoadDefaultTheme();`. The `??` operator returns the left operand when it is not null and evaluates the right operand only when the left is null, so the fallback method runs only when needed. `theme ??= LoadDefaultTheme();` does the same but also stores the fallback back into `theme`.
USAGE:
Combine with `?.`: `user?.Address?.City ?? "unknown"` turns a null anywhere in the chain into one default.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/null-coalescing-operator
The null-coalescing operator ?? returns the value of its left-hand operand if it's not null. Otherwise, it evaluates the right-hand operand and returns its result. The ?? operator doesn't evaluate its right-hand operand if the left-hand operand evaluates to non-null.

## net-null-02 | d1
TOPIC: 1.3 Nullability
Q:
In a brand-new .NET 8 console project, `string name = null;` produces a compiler warning, but the same line in a project created from a .NET 5 template compiles silently. Why the difference?
A:
New projects from .NET 6 and later templates set `<Nullable>enable</Nullable>` in the .csproj, so plain `string` means non-nullable and assigning null warns (CS8625). Projects from earlier templates lack that property, so the nullable context is disabled and the line is not checked.
USAGE:
If a project shows no nullable warnings at all, check the .csproj first: the setting is per project, not per SDK.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/nullable-migration-strategies
New projects created from .NET 6 or later templates already have <Nullable>enable</Nullable> set.

## net-null-03 | d1
TOPIC: 1.3 Nullability
Q:
With nullable enabled, a public library method declares a non-nullable `string name` parameter. Can a caller still pass null at run time, and should the method still check for it?
A:
Yes, and yes. Nullable reference types only drive compiler warnings; nothing is enforced at run time, so callers with nullable disabled, callers using `!`, or reflection can still pass null. Public entry points should keep a guard such as `ArgumentNullException.ThrowIfNull(name);`.
USAGE:
In an interview, say "`string` and `string?` are the same runtime type; the `?` is only design intent for the compiler."
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references
The runtime behavior of your program is unchanged. Nullable reference types are entirely a compile-time feature.

## net-null-04 | d1
TOPIC: 1.3 Nullability
Q:
What does this program print?
```csharp
var a = new Odd();
Console.WriteLine(a == null);
Console.WriteLine(a is null);
class Odd
{
    public static bool operator ==(Odd? x, Odd? y) => true;
    public static bool operator !=(Odd? x, Odd? y) => false;
}
```
OPT: a *
`True`, then `False`
OPT: b
`True`, then `True`
WHY:
That assumes `is null` calls the overloaded `==`. The compiler guarantees it does not, so `a is null` checks the reference itself and prints `False`.
OPT: c
`False`, then `False`
WHY:
Comparing with the `null` literal still binds to the user-defined `operator ==(Odd?, Odd?)`, and that operator returns true here, so the first line prints `True`.
OPT: d
It does not compile: `is null` is rejected on a type that overloads `==`
WHY:
The null constant pattern works on any reference type, with or without operator overloads; the program compiles and runs.
A:
It prints `True` then `False`. `a == null` calls the user-defined operator, which returns true, while the `is null` pattern never calls an overloaded `==`, so it reports the real reference check.
USAGE:
Prefer `is null` / `is not null` in library code: a buggy or odd equality overload cannot change the result.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/patterns
The compiler guarantees that it doesn't invoke a user-overloaded equality operator == when it evaluates expression x is null.

## net-null-05 | d1
TOPIC: 1.3 Nullability
Q:
A DTO declares `public string Name { get; set; }` with nullable enabled. When a client omits `Name`, `JsonSerializer.Deserialize` still succeeds and leaves it null. Which change makes the serializer itself reject such payloads?
OPT: a *
Add the `required` modifier to `Name`
OPT: b
Rely on the non-nullable `string` type, since nullable is enabled
WHY:
It is already non-nullable and the payload still deserializes: a missing property simply means the setter is not called, and the annotation does not make it required.
OPT: c
Add the DataAnnotations `[Required]` attribute to `Name`
WHY:
`JsonSerializer` ignores DataAnnotations; `[Required]` is read only by a validation step such as MVC model validation, after deserialization has already succeeded.
OPT: d
Initialize the property with `= string.Empty`
WHY:
This removes the null but hides the problem: a payload without `Name` is accepted silently with an empty string instead of being rejected.
A:
Add the `required` modifier. System.Text.Json treats required members as mandatory, so `Deserialize` throws `JsonException` when `Name` is missing, and the bad payload fails at the boundary instead of deep inside the app.
USAGE:
`[JsonRequired]` gives the same serializer behavior when you want the rule to apply only to JSON, not to C# object creation.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/required-properties
The following code snippet shows an example of a property modified with the required keyword. This property must be present in the JSON payload for deserialization to succeed.

## net-null-06 | d2
TOPIC: 1.3 Nullability
Q:
In code review you see `repo.Find(id)!.Name` and a dozen `= null!` property initializers added just to clear nullable warnings. What is the risk, and what should replace them?
A:
Each `!` silences the warning exactly where a null bug can occur, and `= null!` added only to silence warnings hides members that may never be initialized. Replace `Find(id)!` with an explicit check (`?? throw new KeyNotFoundException(...)`), give such members real initialization through constructors or `required` members, and otherwise restructure the code so the compiler can prove non-null, because `!` itself checks nothing.
USAGE:
Treat each `!` as a "prove it" review comment; the accepted exception is a member a framework sets, such as an EF Core navigation property.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references
Use ! sparingly. Each occurrence is a place the compiler can no longer protect you. Prefer adding a null check, restructuring the code, or annotating the relevant API so the compiler reaches the right conclusion on its own.

## net-null-07 | d2
TOPIC: 1.3 Nullability
QUALIFIER: BEST
Q:
Callers get warning CS8602 on `user.Name` even inside the success branch. Which signature change for `TryGetUser` is BEST, without callers using `!`?
```csharp
if (UserStore.TryGetUser(42, out var user))
    Console.WriteLine(user.Name); // CS8602
public static class UserStore
{
    public static bool TryGetUser(int id, out User? user)
    {
        user = id == 42 ? new User("Ada") : null;
        return user is not null;
    }
}
```
OPT: a *
`[NotNullWhen(true)] out User? user`
OPT: b
`[NotNull] out User? user`
WHY:
`[NotNull]` promises the argument is non-null on every return, including the false path where it is null, so callers lose a warning they need.
OPT: c
`out User user`, with the parameter non-nullable
WHY:
The method must still assign null on failure, which now warns inside `TryGetUser`, and the signature falsely claims a user is returned every time.
OPT: d
`[MemberNotNullWhen(true, nameof(user))]` on the method
WHY:
`MemberNotNullWhen` describes fields and properties of the containing type, not parameters, so it says nothing about the `out` argument.
A:
Annotate the parameter with `[NotNullWhen(true)]`. Null-state analysis at the call site does not look inside the methods you call, so the contract must be in the signature: the argument may be null, but is not null when the method returns true. Inside `if (TryGetUser(...))` the warning disappears, and the false branch still warns.
USAGE:
`Dictionary.TryGetValue` uses the mirror form, `[MaybeNullWhen(false)] out TValue`, which suits generic `TValue`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis
In the preceding example, the value of message is known to be not null when TryGetMessage returns true. You should annotate similar methods in your codebase in the same way: the arguments could be null, and are known to be not null when the method returns true.

## net-null-08 | d2
TOPIC: 1.3 Nullability
QUALIFIER: BEST
Q:
You add `required` to `Person.Name`. Existing calls `new Person("Ada")`, to a constructor that already assigns `Name`, now fail with CS9035. What is the BEST fix?
OPT: a *
Add `[SetsRequiredMembers]` to that constructor
OPT: b
Change the `Name` setter from `set` to `init`
WHY:
`init` controls when the property can be assigned, not whether the caller must assign it; the member is still required and CS9035 remains.
OPT: c
Give the property a default: `required string Name { get; set; } = "";`
WHY:
A required member must be set by every object creation regardless of an initializer, so the default value does not satisfy the requirement and the error stays.
OPT: d
Mark the constructor parameter `required string name` instead
WHY:
`required` applies only to fields and properties; it is not a parameter modifier, so this is a syntax error and the call sites stay broken.
A:
Add `[SetsRequiredMembers]` to the constructor. It asserts that the constructor initializes all required members, so callers may skip the object initializer. The cost: the compiler does not verify that claim, so a constructor that forgets a required member compiles silently.
USAGE:
Every constructor that chains to a `[SetsRequiredMembers]` constructor needs the attribute too.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/required
You can write your own constructor with the System.Diagnostics.CodeAnalysis.SetsRequiredMembersAttribute attribute. However, the compiler doesn't verify that these constructors do initialize all required members. Rather, the attribute asserts to the compiler that the constructor does initialize all required members.

## net-generics-01 | d1
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
Why would you store order totals in a `List<decimal>` rather than an `ArrayList`, and what goes wrong with the `ArrayList`?
A:
`List<decimal>` lets the compiler guarantee that only decimals go in and come out, with no casts and no boxing. An `ArrayList` stores `object`, so every decimal is boxed on `Add`, must be cast on read, and a wrongly typed item fails only at run time with `InvalidCastException`.
USAGE:
Say "generics move type checks from run time to compile time and avoid boxing for value types."
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/generics/
Type safety. Generics shift the burden of type safety from you to the compiler. There is no need to write code to test for the correct data type because it is enforced at compile time.

## net-generics-02 | d1
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
A method takes a callback that receives an `Order` and must decide whether to ship it. Which built-in delegate type fits, and why not `Action<Order>`?
A:
`Func<Order, bool>`, because the callback has to return a decision and `Action<Order>` returns `void`, so the method could never read the answer. `Predicate<Order>` has the same shape, but LINQ and most APIs use `Func<T, bool>`, and the two are distinct types that do not convert implicitly.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions
If a lambda expression doesn't return a value, convert it to one of the Action delegate types. If it returns a value, convert it to one of the Func delegate types.

## net-generics-03 | d1
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
Why declare `public event EventHandler? Completed;` instead of a public field `public EventHandler? Completed;` of the same delegate type?
A:
The `event` keyword lets outside code only subscribe and unsubscribe with `+=` and `-=`; only the declaring class can raise it. With a public delegate field, any caller could invoke it or assign `Completed = null`, silently wiping out every other subscriber.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/distinguish-delegates-events
Classes other than the one in which an event is contained can only add and remove event listeners; only the class containing the event can invoke the event.

## net-generics-04 | d1
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
This generic factory does not compile. Which constraint added to `Create<T>` makes it compile?
```csharp
static T Create<T>() => new T();
Console.WriteLine(Create<object>());
```
OPT: a
where T : class
WHY:
Being a reference type does not imply a parameterless constructor (`string` has none), so `new T()` is still rejected.
OPT: b *
where T : new()
OPT: c
where T : notnull
WHY:
`notnull` only rules out nullable type arguments; it says nothing about constructors, so `new T()` still fails.
OPT: d
where T : IComparable<T>
WHY:
An interface constraint cannot require a constructor, so the compiler still cannot assume `new T()` is valid.
A:
`where T : new()` requires every type argument to have an accessible parameterless constructor, which is exactly what `new T()` needs; without it the compiler reports CS0304.
USAGE:
Typical in generic factories and repositories; `new()` cannot pass constructor arguments, so use a `Func<T>` factory when construction needs parameters.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/where-generic-type-constraint
The new() Constraint lets the compiler know that any type argument supplied must have an accessible parameterless constructor.

## net-generics-05 | d2
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
What does this program print, and why?
```csharp
var actions = new List<Action>();
for (int i = 0; i < 3; i++)
    actions.Add(() => Console.Write(i));
foreach (var a in actions) a();
```
A:
It prints `333`. A lambda captures the variable, not its current value, and a `for` loop has a single `i` shared by all iterations, so every lambda reads `i` after the loop ended at 3. Copying it into a local inside the body (`int copy = i;`) gives each lambda its own variable; `foreach` already declares a fresh variable per iteration.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions
If a for-loop declares an iteration variable, that variable itself is considered to be declared outside of the loop.

## net-generics-06 | d2
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
An event has three subscribers and the second handler throws an exception it does not catch. Does the third handler run, and what does the code that raised the event see?
A:
The third handler does not run, and the exception propagates out of the raise call to the publisher. Raising an event invokes the multicast delegate's invocation list one by one on the same thread, so an uncaught exception stops the loop. If every handler must run, iterate `GetInvocationList()` and wrap each call in `try`/`catch`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/using-delegates
When any of the methods throws an exception that isn't caught within the method, that exception is passed to the caller of the delegate. No subsequent methods in the invocation list are called.

## net-generics-07 | d2
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
`Where(t => t > 100)` compiles on this `IQueryable<int>` (the same interface an EF Core `DbSet` exposes), but the version below does not. Why?
```csharp
IQueryable<int> totals = new[] { 50, 150 }.AsQueryable();
var big = totals.Where(t => { return t > 100; });
```
A:
`Queryable.Where` takes an `Expression<Func<T, bool>>`, and the compiler builds expression trees only from expression-bodied lambdas, so a block body fails with CS0834. A query provider such as EF Core needs that tree as data to translate into SQL, so keep predicates as single expressions and move complex logic into composable expressions.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/
The C# compiler generates expression trees only from expression lambdas (or single-line lambdas). It can't parse statement lambdas (or multi-line lambdas).

## net-generics-08 | d2
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
What does this program print?
```csharp
Func<int> f = () => 1;
f += () => 2;
Console.WriteLine(f());
```
OPT: a
1
WHY:
Both lambdas run in order, and the value of the first one is discarded; the call returns what the last one returned.
OPT: b *
2
OPT: c
3
WHY:
A multicast delegate does not combine return values; it returns only the last method's result, so nothing is summed.
OPT: d
It does not compile, because `+=` cannot combine `Func` delegates
WHY:
`+=` works on any delegate type with matching type, including `Func<int>`; it appends the second lambda to the invocation list.
A:
It prints `2`. Invoking a multicast delegate calls every method in its invocation list in order, but a delegate with a return value returns the result of the last method invoked.
USAGE:
To collect every handler's result, loop over `GetInvocationList()` and invoke each delegate yourself.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/delegates/using-delegates
If the delegate has a return value and/or out parameters, it returns the return value and parameters of the last method invoked.

## net-generics-09 | d2
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
Given `class Cat : Animal`, which assignment compiles?
OPT: a
`List<Animal> a = new List<Cat>();`
WHY:
`List<T>` is invariant because it also accepts `T` through `Add`; if this compiled, `a.Add(new Dog())` would put a dog into a list of cats.
OPT: b *
`IEnumerable<Animal> a = new List<Cat>();`
OPT: c
`IEnumerable<object> o = new List<int>();`
WHY:
Variance works only for reference types; `int` is a value type, so `IEnumerable<int>` is not an `IEnumerable<object>`.
OPT: d
`Action<Cat> c = x => {}; Action<Animal> a = c;`
WHY:
`Action<in T>` is contravariant, so conversion goes the other way: an `Action<Cat>` could otherwise be handed a `Dog`.
A:
`IEnumerable<Animal> a = new List<Cat>()` compiles because `IEnumerable<out T>` is covariant: it only returns `T`, so a sequence of cats can safely be read as a sequence of animals.
USAGE:
Accept `IEnumerable<Animal>` or `IReadOnlyList<Animal>` parameters instead of `List<Animal>` so callers can pass a `List<Cat>` without copying.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/generics/covariance-and-contravariance
Several generic interfaces have covariant type parameters, for example, IEnumerable<T>, IEnumerator<T>, IQueryable<T>, and IGrouping<TKey,TElement>. All the type parameters of these interfaces are covariant, so the type parameters are used only for the return types of the members.

## net-generics-10 | d2
TOPIC: 1.4 Generics, Delegates and Lambdas
Q:
In a hot path, a teammate changes `key => Compute(key)` to `static key => Compute(key)` in a call to `ConcurrentDictionary.GetOrAdd`. What does the `static` modifier guarantee?
OPT: a
Captured locals are copied by value when the lambda is created, so later changes are not seen.
WHY:
A static lambda captures nothing at all, so there is nothing to copy; ordinary lambdas capture variables, not values.
OPT: b
The lambda can no longer read static fields or constants; every input must arrive through its parameter.
WHY:
Static lambdas may still reference static members and constants; only locals, parameters of the enclosing method, and instance state are off-limits.
OPT: c *
Any capture of a local or `this` becomes a compile error, so no hidden closure is allocated.
OPT: d
`GetOrAdd` invokes the lambda only once per process and reuses that result for every key.
WHY:
`static` says nothing about how often the delegate runs; `GetOrAdd` calls the factory per missing key and may call it more than once under contention.
A:
The `static` modifier makes any capture of a local or instance state a compile error. A lambda that captures nothing needs no closure object, so the hot path cannot start allocating one per call because someone later references a local.
USAGE:
Pair it with the `GetOrAdd(key, factory, factoryArgument)` overload to pass extra state without capturing it.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/lambda-expressions
A static lambda can't capture local variables or instance state from enclosing scopes, but it can reference static members and constant definitions.

## net-coll-01 | d1
TOPIC: 1.5 Collections
Q:
Every request must check whether a user ID is among 50,000 blocked IDs. Which collection do you keep the IDs in, and why not a `List<T>`?
A:
A `HashSet<T>`, because its `Contains` is a hash lookup that takes about constant time (O(1)). `List<T>.Contains` scans linearly (O(n)), so each request could compare against all 50,000 IDs.
USAGE:
Say "hash lookup versus linear scan"; the set also ignores duplicate IDs, which suits a blocklist.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.hashset-1?view=net-8.0
The HashSet<T> class is based on the model of mathematical sets and provides high-performance set operations similar to accessing the keys of the Dictionary<TKey,TValue> or Hashtable collections. In simple terms, the HashSet<T> class can be thought of as a Dictionary<TKey,TValue> collection without values.

## net-coll-02 | d1
TOPIC: 1.5 Collections
Q:
An app processes print jobs in the order they arrive and also keeps an undo history for its editor. Which collection fits each job, and why?
A:
Use `Queue<T>` for the print jobs and `Stack<T>` for the undo history. A queue is first-in, first-out, so `Dequeue` returns the oldest job; a stack is last-in, first-out, so `Pop` returns the latest edit, which undo must reverse first.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/collections/selecting-a-collection-class
If yes, consider using the Queue class or the Queue<T> generic class if you need first-in, first-out (FIFO) behavior. Consider using the Stack class or the Stack<T> generic class if you need last-in, first-out (LIFO) behavior.

## net-coll-03 | d1
TOPIC: 1.5 Collections
Q:
A code review flags `if (prices.ContainsKey(sku)) { total += prices[sku]; }` on a `Dictionary<string, decimal>`. Why do reviewers prefer `TryGetValue` here?
A:
When the key exists, `ContainsKey` plus the indexer hashes and probes for it twice; `TryGetValue` does one lookup and returns the value through an `out` parameter. For a missing key both patterns do one lookup, so the saving is on hits, and the single call cannot drift if the check and read get separated.
CODE: csharp
var prices = new Dictionary<string, decimal> { ["A1"] = 9.99m };
decimal total = 0;
if (prices.TryGetValue("A1", out var price))
    total += price;
Console.WriteLine(total);
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.dictionary-2.trygetvalue?view=net-8.0
This method combines the functionality of the ContainsKey method and the Item[] property.

## net-coll-04 | d1
TOPIC: 1.5 Collections
QUALIFIER: BEST
Q:
A hot loop adds about 100,000 items to a new `List<T>`, and you know the count up front. What is the BEST way to avoid the cost of the list growing?
OPT: a
Call `TrimExcess` once the loop finishes so the list releases its spare capacity
WHY:
`TrimExcess` shrinks the array after the fact; every reallocation and copy made while the list grew during the loop has already been paid for.
OPT: b *
Create the list with `new List<T>(100_000)` so its capacity is set up front
OPT: c
Use a `LinkedList<T>` instead, because it grows one node at a time
WHY:
It avoids array copies but allocates a separate node object per item, adding GC pressure and poor memory locality, so it is slower overall than a presized list.
OPT: d
Add the items in batches of 1,000 with `AddRange` instead of one `Add` per item
WHY:
Batching does not change the growth policy: the backing array still has to be replaced and copied each time Count passes Capacity.
A:
Passing the expected count to the constructor (or setting `Capacity`) allocates the backing array once. Otherwise, each time Count reaches Capacity, `Add` allocates a larger array and copies every element, an O(n) step.
USAGE:
Also applies to `Dictionary<TKey,TValue>`, `HashSet<T>` and `StringBuilder`, which accept an initial capacity too.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/collections/
If the capacity needs to be increased to accommodate the new element, adding an item becomes an O(n) operation, where n is Count. The best way to avoid poor performance caused by multiple reallocations is to set the initial capacity to be the estimated size of the collection.

## net-coll-05 | d1
TOPIC: 1.5 Collections
Q:
What happens when this code runs?
```csharp
var nums = new List<int> { 1, 2, 3, 4 };
foreach (var n in nums)
{
    if (n % 2 == 0) nums.Remove(n);
}
Console.WriteLine(nums.Count);
```
OPT: a *
It throws `InvalidOperationException` when the loop advances after removing 2
OPT: b
It prints 2, after removing both 2 and 4 from the list
WHY:
`Remove(2)` invalidates the enumerator, so the next `MoveNext` throws before 4 is ever reached and the `WriteLine` line does not run.
OPT: c
It prints 3, because removing 2 shifts 3 into its slot and the loop skips over it
WHY:
Silent skipping is what an index-based `for` loop does; `foreach` uses the list's enumerator, which detects the change and throws instead of skipping.
OPT: d
It fails to compile because the list is modified inside its own `foreach`
WHY:
The compiler only forbids assigning to the iteration variable `n` (CS1656); calling `Remove` on the list is legal C#, so the failure happens at run time.
A:
It throws `InvalidOperationException` ("Collection was modified") on the iteration after `Remove(2)`, because changing a `List<T>` invalidates its enumerator. Iterate backward with `for`, or call `nums.RemoveAll(n => n % 2 == 0)`.
USAGE:
Common in cleanup loops over cached or tracked items; `RemoveAll` is also a single O(n) pass instead of repeated O(n) removals.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.enumerator.movenext?view=net-8.0
An enumerator remains valid as long as the collection remains unchanged. If changes are made to the collection, such as adding, modifying, or deleting elements, the enumerator is irrecoverably invalidated and the next call to MoveNext throws an InvalidOperationException.

## net-coll-06 | d1
TOPIC: 1.5 Collections
QUALIFIER: BEST
Q:
A public method loops once over the orders it receives and does not modify them. Which parameter type is the BEST choice?
OPT: a
`List<Order>`, so callers know exactly what to pass
WHY:
Callers holding an array, a `HashSet<Order>` or a LINQ query must copy into a list first, and the type hints that the method may mutate it.
OPT: b *
`IEnumerable<Order>`
OPT: c
`ICollection<Order>`, so the method can read `Count`
WHY:
The method does not need `Count`; requiring `ICollection<T>` rejects lazy sequences and exposes `Add` and `Remove`, which a read-only loop has no use for.
OPT: d
`Order[]`, since arrays are the fastest to iterate
WHY:
The speed gain is negligible for one pass, while every caller with a list or query has to call `ToArray()` and allocate a copy.
A:
`IEnumerable<Order>`: take the least-specialized type that supports what the method does. A single forward pass needs only enumeration, so any collection, array or LINQ query can be passed without conversion.
USAGE:
In an interview, pair it with the flip side: return types can be more specific, such as `IReadOnlyList<T>`, when callers need indexing.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/guidelines-for-collections
✔️ DO use the least-specialized type possible as a parameter type. Most members taking collections as parameters use the IEnumerable<T> interface.

## net-coll-07 | d2
TOPIC: 1.5 Collections
Q:
What does this program print, and why?
```csharp
var key = new Key { Id = 1 };
var map = new Dictionary<Key, string> { [key] = "first" };
key.Id = 2;
Console.WriteLine(map.ContainsKey(key));
class Key
{
    public int Id { get; set; }
    public override bool Equals(object? o) => o is Key k && k.Id == Id;
    public override int GetHashCode() => Id;
}
```
A:
It prints `False`. The dictionary filed the entry under hash code 1 and cached that hash; after `Id` changes, the lookup computes hash 2, which no longer matches the stored entry, so the key is not found. The entry is stranded: still counted, but unreachable by key. Use immutable keys, such as a `record` with init-only properties.
USAGE:
Bites when entities with settable ID properties are used as dictionary or HashSet keys and the ID is assigned after insertion.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.dictionary-2?view=net-8.0
As long as an object is used as a key in the Dictionary<TKey,TValue>, it must not change in any way that affects its hash value.

## net-coll-08 | d2
TOPIC: 1.5 Collections
Q:
A class returns `_items.AsReadOnly()` from a property, and a teammate calls the result immutable. What is wrong with that claim, and what would an immutable collection guarantee instead?
A:
`AsReadOnly()` returns a read-only view over the same list: callers cannot modify it, but the owning class still can, and callers see those changes. An `ImmutableList<T>` cannot change after creation; "modifying" methods return a new instance, so every holder keeps a stable snapshot that is safe to share across threads without locks.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.asreadonly?view=net-8.0
A ReadOnlyCollection<T> object does not expose methods that modify the collection. However, if changes are made to the underlying List<T> object, the read-only collection reflects those changes.

## net-coll-09 | d2
TOPIC: 1.5 Collections
Q:
A ticket scheduler uses `PriorityQueue<Ticket, int>` with urgency as the priority (lower is more urgent). Tickets with equal urgency must be served in arrival order. What must you do?
OPT: a
Nothing, because tickets with equal priority already dequeue in insertion order
WHY:
The heap makes no FIFO promise for equal priorities; its sift operations can reorder ties, so arrival order is lost.
OPT: b *
Make the priority a tuple `(urgency, sequenceNumber)` from an increasing counter
OPT: c
Pass a descending `IComparer<int>` to the queue's constructor
WHY:
A reversed comparer only changes which urgency is served first; equal urgencies still compare equal, so their relative order stays unspecified.
OPT: d
Add the tickets with `EnqueueRange` so each batch keeps its order
WHY:
`EnqueueRange` just inserts each element into the same heap; it gives no ordering guarantee among elements with equal priority.
A:
Use a composite priority such as `(urgency, seq++)`. `PriorityQueue` is a min-heap with no FIFO guarantee for ties, so the increasing sequence number breaks every tie: lowest urgency first, then earliest arrival. Value tuples compare element by element with the default comparer.
USAGE:
Bites in job schedulers and rate-limited work queues, where reordered equal-priority items look like random starvation in production.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.priorityqueue-2?view=net-8.0
Elements with the lowest priority are dequeued first. Note that the type does not guarantee first-in-first-out semantics for elements of equal priority.

## net-coll-10 | d2
TOPIC: 1.5 Collections
QUALIFIER: BEST
Q:
A long-lived service builds a lookup table at startup, never changes it afterward, and reads it millions of times. Since .NET 8, which type is the BEST fit?
OPT: a
`ImmutableDictionary<TKey,TValue>` created with `ToImmutableDictionary()`
WHY:
It is tree-based, so lookups cost O(log n); it is optimized for producing cheap modified copies, which a table that is never changed does not need.
OPT: b
`ReadOnlyDictionary<TKey,TValue>` wrapping a regular `Dictionary<TKey,TValue>`
WHY:
It forwards every call to an ordinary dictionary, adding a layer of indirection without any optimization for reads.
OPT: c *
`FrozenDictionary<TKey,TValue>` built with `ToFrozenDictionary()`
OPT: d
`ConcurrentDictionary<TKey,TValue>` filled once at startup
WHY:
It pays for thread-safe writes that this table does not make; concurrent reads of data that does not change need no synchronization.
A:
`FrozenDictionary<TKey,TValue>`. Because it can never change, `ToFrozenDictionary()` spends extra time at creation analyzing the keys and choosing a layout tuned for them, so every later `TryGetValue` is faster. The slow build only pays off for build-once, read-many data.
USAGE:
Typical fit: a static routing, feature-flag or currency-code table built at startup and read on every request.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-8/runtime
These types don't allow any changes to keys and values once a collection is created. That requirement allows faster read operations (for example, TryGetValue()).

## net-linq-01 | d1
TOPIC: 1.6 LINQ
Q:
A teammate rewrites a `from … where … select` query as a `.Where(...).Select(...)` chain "to make it faster". Does that change performance or results, and when are you forced to use method syntax?
A:
No. The compiler translates query syntax into the same method calls, so both forms run identical code and return identical results. Method syntax is required for operators that have no query keyword, such as `Count`, `Max` or `First`.
USAGE:
Pick the form the team reads best; mixing is fine, e.g. a parenthesized query expression followed by `.Count()`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/linq/get-started/write-linq-queries
Query syntax and method syntax are semantically identical, but query syntax is often simpler and easier to read. You must express some queries as method calls. For example, you must use a method call to express a query that retrieves the number of elements that match a specified condition.

## net-linq-02 | d1
TOPIC: 1.6 LINQ
Q:
Each `Order` has a `List<OrderLine> Lines`. You need one flat sequence of every line across all orders. Do you use `Select` or `SelectMany`, and what would the other one give you?
A:
`SelectMany(o => o.Lines)`, which concatenates every order's lines into one `IEnumerable<OrderLine>`. `Select(o => o.Lines)` returns one element per order, an `IEnumerable<List<OrderLine>>`, so you would still need a nested loop.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/projection-operations
Select produces one result value for every source value. The overall result is therefore a collection that has the same number of elements as the source collection. In contrast, SelectMany produces a single overall result that contains concatenated subcollections from each source value.

## net-linq-03 | d1
TOPIC: 1.6 LINQ
Q:
`customers.First(c => c.City == city)` works in testing, but in production some cities have no customers. What happens then, and when would you use `FirstOrDefault` instead?
A:
`First` throws `InvalidOperationException` when no element matches. Use `FirstOrDefault` when "not found" is a normal outcome you handle, then check the result for `null` (the default for a reference type); keep `First` when an empty result means a bug.
USAGE:
With nullable reference types on, `FirstOrDefault` returns `Customer?`, so the compiler reminds you to handle the missing case.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.first?view=net-8.0
The First<TSource>(IEnumerable<TSource>, Func<TSource,Boolean>) method throws an exception if no matching element is found in source. To instead return a default value when no matching element is found, use the FirstOrDefault method.

## net-linq-04 | d1
TOPIC: 1.6 LINQ
Q:
What does this program print?
```csharp
var nums = new List<int> { 1, 2, 3 };
var big = nums.Where(n => n > 1);
nums.Add(4);
Console.WriteLine(string.Join(",", big));
```
A:
It prints `2,3,4`. `Where` only stores the filter; the list is read when `string.Join` enumerates `big`, which happens after 4 was added. Calling `.ToList()` on the query when it is defined would snapshot `2,3` instead.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/linq/get-started/introduction-to-linq-queries
The results of executing the query depend on the contents of the data source when the query is executed rather than when the query is defined.

## net-linq-05 | d1
TOPIC: 1.6 LINQ
QUALIFIER: BEST
Q:
A method receives an `IEnumerable<Order> orders` and only needs to know whether it contains at least one element. Which check is the BEST choice?
OPT: a
`orders.Count() > 0`
WHY:
When the sequence is not a collection (for example a LINQ query or an iterator), `Count()` walks every element just to compare the total with zero.
OPT: b *
`orders.Any()`
OPT: c
`orders.ToList().Count != 0`
WHY:
`ToList()` copies the whole sequence into a new list, enumerating and allocating everything only to test emptiness.
OPT: d
`orders.LongCount() >= 1`
WHY:
`LongCount()` is `Count()` with a 64-bit result; it still enumerates the entire sequence to produce a number the check does not need.
A:
`orders.Any()` returns as soon as it finds the first element, so its cost does not grow with the sequence length. Counting-based checks may enumerate everything, which is why analyzer rule CA1827 flags them.
USAGE:
On EF Core queries the same rule applies: `AnyAsync()` becomes `EXISTS` in SQL instead of counting every matching row.
SOURCE: https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1827
These methods enumerate the entire collection to compute the count. The same check is faster with the Any() method as it avoids enumerating the collection.

## net-linq-06 | d1
TOPIC: 1.6 LINQ
Q:
Customers must be listed alphabetically by `City`, then by `Name` within each city. Which expression produces that order?
OPT: a
`customers.OrderBy(c => c.City).OrderBy(c => c.Name)`
WHY:
The second `OrderBy` starts a new primary sort by `Name`, so the list ends up ordered by name, with city only breaking ties between equal names.
OPT: b *
`customers.OrderBy(c => c.City).ThenBy(c => c.Name)`
OPT: c
`customers.OrderBy(c => c.Name).ThenBy(c => c.City)`
WHY:
The keys are swapped: `Name` becomes the primary order and `City` only orders customers who share a name.
OPT: d
`customers.OrderByDescending(c => c.City).ThenBy(c => c.Name)`
WHY:
It groups by city correctly but lists the cities from Z to A, not alphabetically.
A:
`OrderBy(c => c.City).ThenBy(c => c.Name)`. `ThenBy` extends the existing `IOrderedEnumerable` with a secondary key, so names are sorted only within each city; another `OrderBy` would replace the city order.
USAGE:
In query syntax the same thing is `orderby c.City, c.Name`; the comma becomes `ThenBy`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.orderby?view=net-8.0
Because IOrderedEnumerable<TElement> inherits from IEnumerable<T>, you can call OrderBy or OrderByDescending on the results of a call to OrderBy, OrderByDescending, ThenBy or ThenByDescending. Doing this introduces a new primary ordering that ignores the previously established ordering.

## net-linq-07 | d1
TOPIC: 1.6 LINQ
Q:
Starting from an `Order[] orders`, which call reads the array at the moment it is called, rather than later when results are enumerated?
OPT: a
`orders.Where(o => o.Total > 100)`
WHY:
`Where` returns an `IEnumerable<Order>` that only stores the predicate; it reads the array when that sequence is enumerated.
OPT: b
`orders.Select(o => o.Id)`
WHY:
`Select` is deferred too: it returns a query object and runs the projection element by element during enumeration.
OPT: c
`orders.OrderBy(o => o.CreatedDate)`
WHY:
Sorting has to see every element, but `OrderBy` still defers: it reads and sorts the whole array only when the result is first enumerated.
OPT: d *
`orders.Count(o => o.Total > 100)`
A:
`Count` returns an `int`, not a sequence, so it must iterate the array immediately to produce its value. Operators that return a sequence, such as `Where`, `Select` and `OrderBy`, defer reading until enumeration.
USAGE:
Say "scalar results run now, sequences run later"; call `ToList()` when you need a sequence evaluated immediately.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/linq/get-started/introduction-to-linq-queries
All the standard query operators that return a scalar result execute immediately. Examples of such queries are Count, Max, Average, and First.

## net-linq-08 | d2
TOPIC: 1.6 LINQ
Q:
A repository exposes this method, and a caller writes `repo.GetOrders().Where(o => o.Total > 100).Take(10).ToList()`. What SQL does EF Core send, and how do you fix it?
```csharp
public class OrderRepository(AppDbContext db)
{
    public IEnumerable<Order> GetOrders() => db.Orders;
}
```
A:
A `SELECT` of every row in Orders with no `WHERE` or `TOP`; the filter and `Take` run in memory. Because the return type is `IEnumerable<Order>`, the compiler binds `Enumerable.Where` and `Enumerable.Take`, exactly as if the caller had called `AsEnumerable()`, so EF Core only ever sees the bare table. Return `IQueryable<Order>`, or better, filter inside the repository method.
USAGE:
Tests on a small database pass; production slows down and memory grows with the table.
SOURCE: https://learn.microsoft.com/en-us/ef/core/querying/client-eval
In such cases, you can explicitly opt into client evaluation by calling methods like AsEnumerable or ToList (AsAsyncEnumerable or ToListAsync for async). By using AsEnumerable you would be streaming the results, but using ToList would cause buffering by creating a list, which also takes additional memory.

## net-linq-09 | d2
TOPIC: 1.6 LINQ
Q:
What does this program print, and what does the last number tell you?
```csharp
int calls = 0;
var squares = new[] { 1, 2, 3 }.Select(n => { calls++; return n * n; });
Console.WriteLine(squares.Sum());
Console.WriteLine(squares.Max());
Console.WriteLine(calls);
```
A:
It prints `14`, `9`, then `6`. `squares` is a deferred query, not a list, so `Sum` and `Max` each enumerate it from scratch and the selector runs three times per pass. With an expensive selector (or an EF/IO-backed source), every extra enumeration repeats that work. Materialize once with `ToArray()` or `ToList()` and the selector runs three times in total.
SOURCE: https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1851
Enumeration starts when the collection is passed into a LINQ enumeration method, like ElementAt, or used in a for each statement. The enumeration result is not calculated once and cached, like Lazy.

## net-linq-10 | d2
TOPIC: 1.6 LINQ
Q:
A pull request sends emails inside a projection: `var ids = customers.Select(c => { mailer.Send(c); return c.Id; }).ToList();`. Why do reviewers reject side effects in a query, and what do they ask for instead?
A:
A query should describe data, not act: whether the lambda runs, and for which elements, depends on how the query is consumed, which the call site hides. Without `ToList()` nothing is sent; swap it for `First()` and only one customer is mailed, yet the line still reads like a pure expression. Reviewers ask for a `foreach` that visibly sends to every customer, then a separate side-effect-free projection.
CODE: csharp
var customers = new List<Customer> { new(1), new(2) };
var mailer = new Mailer();
foreach (var c in customers)
    mailer.Send(c);
var ids = customers.Select(c => c.Id).ToList();
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/linq/get-started/write-linq-queries
You can call any method in the context of a query expression. Don't call any method in a query expression that can create a side effect such as modifying the contents of the data source or throwing an exception.

## net-linq-11 | d2
TOPIC: 1.6 LINQ
Q:
Inside a loop over 5,000 customers you need each customer's orders by `CustomerId`. Why build `orders.ToLookup(o => o.CustomerId)` once rather than filter with `Where` per customer, use `GroupBy`, or use `ToDictionary`?
A:
`ToLookup` runs immediately and builds a hashed one-to-many index, so each `lookup[id]` is a fast key lookup, and an unknown key returns an empty sequence. A `Where` per customer rescans every order on each iteration; `GroupBy` is deferred and regroups on every enumeration; `ToDictionary` needs unique keys, so the second order of a customer throws `ArgumentException`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.tolookup?view=net-8.0
The ToLookup<TSource,TKey>(IEnumerable<TSource>, Func<TSource,TKey>) method returns a Lookup<TKey,TElement>, a one-to-many dictionary that maps keys to collections of values. A Lookup<TKey,TElement> differs from a Dictionary<TKey,TValue>, which performs a one-to-one mapping of keys to single values.

## net-linq-12 | d2
TOPIC: 1.6 LINQ
Q:
What does `Queryable.Where` receive that `Enumerable.Where` does not, which lets EF Core turn the filter into SQL?
OPT: a *
The lambda as an expression tree that the provider can inspect and translate
OPT: b
A compiled delegate that EF Core ships to the database to run per row
WHY:
That is what `Enumerable.Where` gets: compiled .NET code, which a database server cannot execute.
OPT: c
A SQL string that the C# compiler generates from the lambda at build time
WHY:
The compiler emits no SQL; the provider translates the query at run time, when it is executed, so the SQL depends on the provider.
OPT: d
A list of rows that EF Core loads and caches when `Where` is called
WHY:
`Where` is deferred and loads nothing; rows are fetched only when the query is enumerated, for example by `ToListAsync`.
A:
`Queryable.Where` takes an `Expression<Func<T, bool>>`, so the compiler builds a data structure describing the lambda instead of compiled code. EF Core walks that expression tree when the query runs and translates it into a SQL `WHERE` clause.
USAGE:
This is why a filter that calls your own C# method can fail at run time in EF Core: the provider cannot translate it.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/
For IQueryable<T>, the query is translated into an expression tree. The expression tree can be translated to a native query when the data source can optimize the query. Libraries such as Entity Framework translate LINQ queries into native SQL queries that execute at the database.

## net-linq-13 | d2
TOPIC: 1.6 LINQ
QUALIFIER: BEST
Q:
Users are looked up by `Email`, which must match exactly one user. A data bug could create duplicate emails, and you want that to fail loudly instead of silently picking one. Which call is the BEST fit?
OPT: a *
`users.Single(u => u.Email == email)`
OPT: b
`users.First(u => u.Email == email)`
WHY:
It returns the first match and ignores any others, so duplicate emails go unnoticed.
OPT: c
`users.FirstOrDefault(u => u.Email == email)`
WHY:
It also ignores duplicates, and a missing user turns into a `null` that fails later, far from the cause.
OPT: d
`users.SingleOrDefault(u => u.Email == email)`
WHY:
It does throw on duplicates, but a missing user yields `null` instead of an error, although the stem requires exactly one match.
A:
`Single` throws `InvalidOperationException` when no user or more than one user matches, so both broken invariants surface at once. The cost is that it keeps scanning after the first match to prove uniqueness.
USAGE:
Back the rule with a unique index on `Email`; `Single` catches violations in code, the index prevents them in data.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.single?view=net-8.0
Returns the only element of a sequence that satisfies a specified condition, and throws an exception if more than one such element exists.

## net-linq-14 | d2
TOPIC: 1.6 LINQ
QUALIFIER: BEST
Q:
`products` is a `List<Product>`, where `Product` is a record with `Name` and `Price`. You need the `Product` with the highest `Price`, not the price itself. Which call is the BEST choice?
OPT: a
`products.Max(p => p.Price)`
WHY:
This overload projects each product to its price and returns the largest `decimal`, so you lose the product it came from.
OPT: b *
`products.MaxBy(p => p.Price)`
OPT: c
`products.Max()`
WHY:
`Product` does not implement `IComparable`, so this throws `ArgumentException` at run time; even if it did, it would compare by that interface, not by `Price`.
OPT: d
`products.First(p => p.Price == products.Max(x => x.Price))`
WHY:
It finds the right product, but recomputes `Max` over the whole list for every element it tests, so it is O(n²) in the worst case.
A:
`MaxBy(p => p.Price)` makes one pass, compares elements by the key, and returns the element that holds the largest key, so you get the whole `Product`. On an empty list of a reference type it returns `null`.
USAGE:
`MinBy` is the mirror image, and `DistinctBy` follows the same key-selector pattern.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.maxby?view=net-8.0
The value with the maximum key in the sequence.

## net-exc-01 | d1
TOPIC: 1.7 Exceptions
Q:
A catch block logs the error and then rethrows it with `throw ex;`. What does the team lose when the error shows up in production logs, and what should the line be instead?
A:
They lose where the failure really happened: `throw ex;` restarts the stack trace at the catch block, so the frames between the original throw and the handler disappear. Write `throw;` inside the catch, which rethrows the same exception with its original stack trace intact.
USAGE:
Code analysis rule CA2200 flags `throw ex;`; mention it to show you know the trap is common enough to have a rule.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements
throw; preserves the original stack trace of the exception, which is stored in the Exception.StackTrace property. In contrast, throw e; updates the StackTrace property of e.

## net-exc-02 | d1
TOPIC: 1.7 Exceptions
Q:
A method opens a `FileStream`, and an exception is thrown halfway through reading it. How do you make sure the file is still closed, and when would you write `finally` instead of `using`?
A:
Wrap the stream in a `using` statement or declaration: the compiler turns it into try/finally, so `Dispose` closes the file whether the block exits normally or by exception. Write an explicit `finally` when the cleanup is not a `Dispose` call, for example resetting a busy flag or restoring state on a type that does not implement `IDisposable`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions
Clean up resources that are allocated with either using statements or finally blocks. Prefer using statements to automatically clean up resources when exceptions are thrown. Use finally blocks to clean up resources that don't implement IDisposable.

## net-exc-03 | d1
TOPIC: 1.7 Exceptions
Q:
Users often type non-numeric text into a quantity box. Why call `int.TryParse` rather than wrapping `int.Parse` in try/catch?
A:
Because bad input here is a routine, expected case, not an exceptional one. `int.TryParse` returns false instead of throwing `FormatException`, so the normal path skips the cost of throwing and catching an exception and reads as a plain if/else.
USAGE:
Same idea for `Dictionary.TryGetValue`: use the Try method whenever failure is part of normal flow.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions
Check for error conditions in code if the event happens routinely and could be considered part of normal execution. When you check for common error conditions, less code is executed because you avoid exceptions.

## net-exc-04 | d1
TOPIC: 1.7 Exceptions
QUALIFIER: BEST
Q:
A public library method must reject a null `order` argument at run time. Which guard is the BEST choice on .NET 8?
OPT: a
`if (order is null) throw new NullReferenceException();`
WHY:
`NullReferenceException` is reserved for the runtime (CA2201); callers expect an `ArgumentNullException` that names the bad parameter.
OPT: b
`Debug.Assert(order is not null);`
WHY:
`Debug.Assert` is compiled out of Release builds, so production has no check and the null fails later as an unrelated `NullReferenceException`.
OPT: c
`if (order is null) throw new Exception("order is null");`
WHY:
The base `Exception` type is too general: callers cannot catch it specifically, and CA2201 flags throwing it.
OPT: d *
`ArgumentNullException.ThrowIfNull(order);`
A:
`ArgumentNullException.ThrowIfNull(order)` is the right guard: it throws the correct exception type, fills in the parameter name automatically, and keeps the guard to one line. CA1510 suggests it in place of hand-written null checks.
USAGE:
For strings, `ArgumentException.ThrowIfNullOrEmpty(name)` adds the empty check in the same single line.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions
Some key .NET exception types have such static throw helper methods that allocate and throw the exception. You should call these methods instead of constructing and throwing the corresponding exception type:

## net-exc-05 | d1
TOPIC: 1.7 Exceptions
QUALIFIER: BEST
Q:
A data-access helper wraps its query in `catch (Exception)`, logs the error and returns null whenever anything fails. Which change is BEST?
OPT: a *
Catch only the exceptions it can recover from and let the rest propagate
OPT: b
Keep `catch (Exception)` but return an empty list instead of null, so callers do not crash
WHY:
Failures are still swallowed: a database outage now looks like "no rows", which is harder to notice than a null.
OPT: c
Add a separate `catch (SystemException)` before `catch (Exception)` so system failures are logged differently
WHY:
Both clauses still swallow every failure and return null; logging them differently does not let any caller react.
OPT: d
Catch everything, wrap it in a new `Exception` with the same message, and throw that
WHY:
Callers can no longer catch specific types, and without passing the original as the inner exception its type and stack trace are lost.
A:
Catch only the exceptions the helper can actually recover from and let the rest propagate. A caller higher up the stack, or the global error handler, can then retry, report or fail fast instead of silently treating an outage as "no data".
USAGE:
In ASP.NET Core, let unexpected exceptions reach the exception-handling middleware, which logs them once and returns a 500.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions
When your code can't recover from an exception, don't catch that exception. Enable methods further up the call stack to recover if possible.

## net-exc-06 | d2
TOPIC: 1.7 Exceptions
Q:
Why write the not-found handling as a `when` filter, as below, instead of catching every `StoreException` and calling `throw;` when the code is not `NotFound`? `store.Read` is synchronous.
```csharp
class OrderLoader(IOrderStore store)
{
    public Order? Load(int id)
    {
        try { return store.Read(id); }
        catch (StoreException ex) when (ex.Code == StoreError.NotFound)
        { return null; }
    }
}
```
A:
Because the filter is evaluated before the stack unwinds, other errors are never caught here. The frames inside `Read` and their locals stay intact, so a debugger breaking on the unhandled exception stops at the original throw. Catch-then-`throw;` unwinds to this handler first, so those frames are gone when it rethrows, even though `throw;` keeps the StackTrace text.
USAGE:
Filters are also a safe place to log: `when (Log(ex))` returning false records the error without catching it.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements
Exception filters (when): The filter expression is evaluated before the stack is unwound. This means the original call stack and all local variables remain intact during filter evaluation.

## net-exc-07 | d2
TOPIC: 1.7 Exceptions
Q:
What does this program print, and what would change if the task were awaited instead of calling `Wait()`?
```csharp
var t = Task.Run(Fail);
try { t.Wait(); }
catch (InvalidOperationException) { Console.WriteLine("IOE"); }
catch (AggregateException ae) { Console.WriteLine($"AE: {ae.InnerException!.GetType().Name}"); }
static void Fail() => throw new InvalidOperationException("boom");
```
A:
It prints `AE: InvalidOperationException`. `Wait()` and `.Result` wrap the task's fault in an `AggregateException`, so the `InvalidOperationException` clause never matches and the real error sits in `InnerExceptions`. `await t` rethrows the original exception unwrapped, so the first clause would catch it and print `IOE`.
USAGE:
One more reason to avoid `.Result`/`.Wait()`: besides blocking a thread, they make catch clauses match `AggregateException` instead of the real error.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/exception-handling-task-parallel-library
To propagate all the exceptions back to the calling thread, the Task infrastructure wraps them in an AggregateException instance. The AggregateException exception has an InnerExceptions property that can be enumerated to examine all the original exceptions that were thrown, and handle (or not handle) each one individually.

## net-exc-08 | d2
TOPIC: 1.7 Exceptions
QUALIFIER: BEST
Q:
An async import passes a `CancellationToken` to `HttpClient` calls and to its own loop, which calls `token.ThrowIfCancellationRequested()`. Which catch clause BEST handles the user cancelling?
OPT: a
`catch (TaskCanceledException)`
WHY:
`ThrowIfCancellationRequested` throws a plain `OperationCanceledException`, the base class, so a cancel observed inside the loop slips past this clause.
OPT: b
`catch (Exception ex)` that logs the cancellation as an error
WHY:
Cancellation is a requested, normal outcome; logging it as an error floods logs and alerts, and the clause also swallows real failures.
OPT: c *
`catch (OperationCanceledException)`
OPT: d
`catch (ObjectDisposedException)` for the disposed token source
WHY:
A cancelled token does not throw `ObjectDisposedException`; cancellation surfaces as `OperationCanceledException` or a derived type.
A:
`catch (OperationCanceledException)` handles every cancellation: the `TaskCanceledException` from `HttpClient` derives from it, and `ThrowIfCancellationRequested` throws the base type itself. Treat it as a normal outcome, not an error.
USAGE:
`HttpClient` timeouts also surface as `TaskCanceledException`; add `when (token.IsCancellationRequested)` to tell a user cancel from a timeout.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions
It's better to catch OperationCanceledException instead of TaskCanceledException, which derives from OperationCanceledException, when you call an asynchronous method. Many asynchronous methods throw an OperationCanceledException exception if cancellation is requested.

## net-modern-01 | d1
TOPIC: 1.8 Modern C# (10-12)
Q:
You need a new int[] holding every element of arrays `first` and `second`, followed by a trailing 0. How do you write it in C# 12 without chaining Concat, Append and ToArray?
A:
Use a collection expression with spread elements: `int[] all = [.. first, .. second, 0];`. Each `..` inlines the elements of an enumerable into the new collection, and the target type `int[]` tells the compiler what to build, so no LINQ chain or extra ToArray call is needed.
USAGE:
The same syntax targets List<T>, Span<T> and ImmutableArray<T>; only the declared type changes.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/collection-expressions
Use a spread element .. to inline collection values in a collection expression.

## net-modern-02 | d1
TOPIC: 1.8 Modern C# (10-12)
Q:
A Settings class must be filled with `new Settings { BaseUrl = "..." }` and never changed afterward. Which accessor do you give BaseUrl, and how does it differ from `private set`?
A:
Declare it `public string BaseUrl { get; init; }`. An init accessor can be called only during object construction, including in an object initializer, and then the property is read-only; `private set` rejects initializers outside the class but lets the class's own methods change the value at any time.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/init
An init-only setter assigns a value to the property or the indexer element only during object construction. An init enforces immutability, so that once the object is initialized, it can't be changed.

## net-modern-03 | d1
TOPIC: 1.8 Modern C# (10-12)
Q:
New .NET templates start a file with `namespace Shop.Api;` and no braces. What does that line mean for the types in the file, and why do teams prefer it over the block form?
A:
Every type declared in that file belongs to the `Shop.Api` namespace. It means the same as wrapping the whole file in one namespace block, so it saves a level of braces and indentation; the cost is one namespace per file, with no nested or second namespace declaration.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/namespace
File scoped namespace declarations enable you to declare that all types in a file are in a single namespace.

## net-modern-04 | d1
TOPIC: 1.8 Modern C# (10-12)
Q:
A new .NET 8 console project uses `List<T>` and `File.ReadAllText`, yet no source file contains a using directive. Why does it compile?
OPT: a
The C# 12 compiler automatically imports every System.* namespace into each source file of the project
WHY:
The language imports nothing by itself; set ImplicitUsings to disable and the same code fails to compile because List<T> and File are not found.
OPT: b
Top-level statements give Program.cs and the rest of the project access to every BCL namespace
WHY:
Top-level statements only generate the entry point and add no imports; other files without top-level statements see the same types, so the imports come from elsewhere.
OPT: c *
The SDK generates global using directives into a file under obj, driven by the ImplicitUsings property
OPT: d
List<T> and File are declared in the global namespace, so no import is ever needed for them
WHY:
They live in System.Collections.Generic and System.IO; the short names resolve only because a generated global using imports those namespaces.
A:
The .NET SDK writes implicit global using directives (System, System.IO, System.Collections.Generic and others) to a generated file in obj, because new projects set `<ImplicitUsings>enable</ImplicitUsings>`; with that property disabled, the same code no longer compiles.
USAGE:
Add project-wide imports with `<Using Include="..." />` items in the .csproj rather than repeating using lines.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview
Starting in .NET 6, implicit global using directives are added to new C# projects. This means that you can use types defined in these namespaces without having to specify their fully qualified name or manually add a using directive. The implicit aspect refers to the fact that the global using directives are added to a generated file in the project's obj directory.

## net-modern-05 | d1
TOPIC: 1.8 Modern C# (10-12)
Q:
Given `public record Point(int X, int Y);`, what does `new Point(1, 2) == new Point(1, 2)` evaluate to?
OPT: a
false, because the two expressions create two separate objects on the heap
WHY:
That is reference equality, the default for plain classes; a record synthesizes == and Equals that compare values instead of references.
OPT: b *
true, because records compare their type and the values they store
OPT: c
It does not compile, because == is not defined for user-defined reference types
WHY:
The compiler synthesizes operator == and operator != for every record, so the comparison compiles.
OPT: d
true, but only after you override Equals and GetHashCode in the record
WHY:
A record already generates value-based Equals and GetHashCode; you override them only to customize equality, not to enable it.
A:
true. A record synthesizes Equals, GetHashCode and the == and != operators so that two instances are equal when they have the same runtime type and equal stored values, even though they are separate objects.
USAGE:
Records suit DTOs and value objects that are compared by content, such as cache keys or messages.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record
For types with the record modifier (record class, record struct, and readonly record struct), two objects are equal if they are of the same type and store the same values.

## net-modern-06 | d2
TOPIC: 1.8 Modern C# (10-12)
Q:
A teammate writes `public class OrderService(IOrderRepository repo)` and expects callers to read `service.repo` and methods to use `this.repo`, as with a record. What actually happens, and what is `repo`?
A:
Neither compiles: on a class, `repo` is a constructor parameter in scope for the whole body, not a field or property. The compiler captures it in a hidden private field only if a member uses it, and it stays assignable like any parameter; to expose it, declare a member such as `public IOrderRepository Repo { get; } = repo;`. Only records turn primary-constructor parameters into public properties.
USAGE:
Primary constructors on services are fine for DI; just remember the parameter is mutable, not readonly.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/tutorials/primary-constructors
Primary constructor parameters aren't members of the class. For example, a primary constructor parameter named param can't be accessed as this.param.

## net-modern-07 | d2
TOPIC: 1.8 Modern C# (10-12)
Q:
What does this program print, and why?
```csharp
var a = new Order("A", ["new"]);
var b = a with { Id = "B" };
b.Tags.Add("paid");
Console.WriteLine(a.Tags.Count);
record Order(string Id, List<string> Tags);
```
A:
It prints 2. A `with` expression makes a shallow copy: it copies the reference held in Tags, not the list, so `a` and `b` share one List<string> and the item added through `b` is visible through `a`. To isolate the copy, write `a with { Id = "B", Tags = [.. a.Tags] }` or use an immutable collection.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record
The result of a with expression is a shallow copy. For a reference property, the expression copies only the reference to an instance. Both the original record and the copy end up with a reference to the same instance.

## net-modern-08 | d2
TOPIC: 1.8 Modern C# (10-12)
Q:
This compiles with only a warning. What happens when it runs, and how do you fix it?
```csharp
Console.WriteLine(Rate(new Order(50m, "DE")));
static string Rate(Order o) => o switch
{
    { Total: > 100m } => "free",
    { Country: "US" } => "flat",
};
record Order(decimal Total, string Country);
```
A:
It throws `SwitchExpressionException` at run time: 50 is not over 100 and "DE" is not "US", so no arm matches, and a switch expression must produce a value. Treat the non-exhaustive warning (CS8509) as a bug and add a final discard arm such as `_ => "standard"`, or throw a meaningful exception there.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/switch-expression
If none of a switch expression's patterns matches an input value, the runtime throws an exception. In .NET Core 3.0 and later versions, the exception is a System.Runtime.CompilerServices.SwitchExpressionException.

## net-modern-09 | d2
TOPIC: 1.8 Modern C# (10-12)
Q:
After `var p = new Point(1, 2);`, which declaration of Point lets the next line, `p.X = 10;`, compile?
OPT: a
public record Point(int X, int Y);
WHY:
A positional record class generates init-only properties, so assigning X after construction is a compile error (CS8852).
OPT: b
public readonly record struct Point(int X, int Y);
WHY:
A readonly record struct also generates init-only positional properties, so X can be set only during construction or in a with expression.
OPT: c
public sealed record Point(int X, int Y);
WHY:
sealed only prevents inheritance; this is still a record class whose positional properties are init-only.
OPT: d *
public record struct Point(int X, int Y);
A:
`public record struct Point(int X, int Y);`. For a non-readonly record struct the compiler generates read-write positional properties, whereas record classes and readonly record structs get init-only ones, so only the record struct allows assignment after construction.
USAGE:
Prefer readonly record struct for small value types unless you deliberately want mutation.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record
Positional properties are immutable in a record class and a readonly record struct. They're mutable in a record struct.

## net-modern-10 | d2
TOPIC: 1.8 Modern C# (10-12)
QUALIFIER: BEST
Q:
A command parser must accept any `string[] args` whose first element is "deploy" and last is "--force", with zero or more items between. Which `args is ...` pattern is BEST?
OPT: a
`["deploy", _, "--force"]`
WHY:
The discard matches exactly one element, so only three-item arrays match; `["deploy", "--force"]` and longer commands are rejected.
OPT: b
`["deploy", var rest, "--force"]`
WHY:
A var pattern binds a single element, not a range, so this also matches only arrays of exactly three items.
OPT: c *
`["deploy", .., "--force"]`
OPT: d
`["deploy", .., var last]`
WHY:
It accepts any last element and only binds it to `last`, so a command without "--force" at the end still matches.
A:
`["deploy", .., "--force"]`. A list pattern checks elements by position, and the slice pattern `..` matches zero or more elements, so the pattern requires "deploy" first and "--force" last with any number of items between, including none.
USAGE:
Write `.. var middle` instead of `..` when you also need the items between as a slice.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/patterns
A slice pattern matches zero or more elements. You can use at most one slice pattern in a list pattern. The slice pattern can only appear in a list pattern.

## net-modern-11 | d2
TOPIC: 1.8 Modern C# (10-12)
Q:
What does this program print?
```csharp
var json = """
    {
      "id": 1
    }
    """;
Console.WriteLine(json.StartsWith('{'));
```
OPT: a *
True, because indentation left of the closing quotes is stripped
OPT: b
False, because the four leading spaces before { stay in the string
WHY:
Whitespace to the left of the closing quotes is removed from every content line, so the four leading spaces are not part of the value.
OPT: c
False, because the string starts with the newline after the opening quotes
WHY:
The line break after the opening quotes is not part of the content; the value starts with the first character of the next line.
OPT: d
It does not compile, because the quotes around id must be escaped
WHY:
A raw string literal needs no escapes; a run of quotes shorter than the three-quote delimiter is plain content.
A:
True. The closing quotes sit four spaces in, so the compiler removes those four spaces from every content line, and the newline after the opening quotes is not part of the value; the string begins with `{`.
USAGE:
Raw strings are ideal for JSON test payloads and SQL; indent the closing quotes to match the content.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/raw-string
Any whitespace to the left of the closing quotes is removed from all lines of the raw string literal.

## net-modern-12 | d2
TOPIC: 1.8 Modern C# (10-12)
QUALIFIER: BEST
Q:
It is October 2026 and your API runs on .NET 8, an LTS release. The team wants the longest supported runway from a single upgrade. Which plan is BEST?
OPT: a
Upgrade to the STS release that directly followed .NET 8, moving one version at a time
WHY:
That Standard Term Support release has a two-year window that also ends in November 2026, so the upgrade buys no extra supported time.
OPT: b
Stay on .NET 8, because LTS releases receive five years of support from Microsoft
WHY:
LTS means three years (or one year after the next LTS ships, if later); .NET 8 support ends in November 2026, and then security patches stop.
OPT: c
Stay on .NET 8 and let the runtime roll forward automatically to newer major versions
WHY:
Roll-forward stays within the major version by default; an app targeting .NET 8 does not move to a newer major version on its own.
OPT: d *
Upgrade to the current LTS release, which is supported until November 2028
A:
Upgrade to the current Long Term Support release. .NET 8 (LTS) and the STS release after it both leave support in November 2026, while the current LTS is supported until November 2028, so one upgrade now buys two more supported years.
USAGE:
Check the support table on the releases page before planning; an unsupported runtime gets no security patches.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/releases-and-support
.NET 10 (Long Term Support) - supported until November 2028. .NET 9 (Standard Term Support) - supported until November 2026. .NET 8 (Long Term Support) - supported until November 2026.

## net-async-01 | d1
TOPIC: 2.1 Async and Task
Q:
A method reaches `await httpClient.GetStringAsync(url)` and the download takes two seconds. What happens to the method and to the thread during those two seconds?
A:
The method is suspended at the `await` and an incomplete task goes back to its caller, so the thread is free for other work. When the download completes, the rest of the method resumes as a continuation, so no thread sits blocked waiting on the network.
USAGE:
Say "await frees the thread, it does not block it"; that is why async I/O lets a web server handle more concurrent requests.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-scenarios
When you apply the await keyword, the code suspends the calling method and yields control back to its caller until the task completes.

## net-async-02 | d1
TOPIC: 2.1 Async and Task
Q:
About how long does this program take, and how do you bring it down to about one second?
```csharp
var sw = System.Diagnostics.Stopwatch.StartNew();
await LoadAsync("users");
await LoadAsync("orders");
await LoadAsync("prices");
Console.WriteLine(sw.Elapsed.TotalSeconds);
static Task LoadAsync(string name) => Task.Delay(1000);
```
A:
About three seconds, because each `await` waits for one load to finish before the next one starts. Start all three tasks first and then `await Task.WhenAll(t1, t2, t3)`, so the independent waits overlap and the total is about one second.
USAGE:
Independent I/O calls (several HTTP or database lookups) awaited one after another are a common, easy latency win in code review.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/
The thread doesn't block while the eggs or hash browns are cooking, but the code also doesn't start other tasks until the current work completes.

## net-async-03 | d1
TOPIC: 2.1 Async and Task
Q:
A WPF button handler is marked `async` but calls a CPU-heavy `CalculateReport()` directly, and the UI still freezes. Why, and how does the fix differ for CPU-bound versus I/O-bound work?
A:
`async` does not create a thread: the handler runs synchronously on the UI thread until it reaches an incomplete await, so the calculation blocks the UI. For CPU-bound work, offload it with `await Task.Run(() => CalculateReport())`; for I/O-bound work, await a truly asynchronous API such as `ReadAsync`, which needs no extra thread while it waits.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap
The async keyword doesn't force a method to run asynchronously on another thread. It enables await, and the method runs synchronously until it reaches an incomplete awaitable.

## net-async-04 | d1
TOPIC: 2.1 Async and Task
Q:
Does the `catch` block in this program run, and what happens to the exception?
```csharp
try { SaveAsync(); }
catch (Exception) { Console.WriteLine("caught"); }
await Task.Delay(500);
async void SaveAsync()
{
    await Task.Delay(10);
    throw new InvalidOperationException();
}
```
A:
No: `SaveAsync()` returns to the caller at its first `await`, so the `try` block has already finished when the exception is thrown. An `async void` method has no task to store the exception, so it is raised as unhandled and crashes the process. Return `Task` and `await` the call so the caller can catch it.
USAGE:
Keep `async void` for event handlers only; everywhere else return `Task` so failures reach the caller.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-return-types
The caller of a void-returning async method can't catch exceptions thrown from the method. Such unhandled exceptions are likely to cause your application to fail.

## net-async-05 | d1
TOPIC: 2.1 Async and Task
QUALIFIER: BEST
Q:
An async method retries an HTTP call and must wait two seconds between attempts. Which way of waiting is the BEST choice?
OPT: a
`Thread.Sleep(2000);` inside the loop
WHY:
Sleep blocks the current thread for the whole two seconds, so a thread-pool thread sits idle instead of serving other work.
OPT: b *
`await Task.Delay(2000);` inside the loop
OPT: c
`Task.Delay(2000);` inside the loop, with no `await`
WHY:
The delay task is created and discarded, so the method continues immediately and retries with no pause at all.
OPT: d
`SpinWait.SpinUntil(() => false, 2000);` inside the loop
WHY:
SpinUntil blocks the calling thread for the full two seconds (spinning, then yielding and sleeping in a loop), so like Thread.Sleep it wastes a pool thread.
A:
`await Task.Delay(2000)` suspends the method on a timer and releases the thread, then resumes after two seconds. It also accepts a CancellationToken, so the retry loop can stop promptly on shutdown.
USAGE:
A `Thread.Sleep` inside async code is a classic review finding; it quietly costs a pool thread per waiting request.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/consuming-the-task-based-asynchronous-pattern
Use the Task.Delay method to add pauses into an asynchronous method's execution. This pause is useful for many kinds of functionality, including building polling loops and delaying the handling of user input for a predetermined period of time.

## net-async-06 | d1
TOPIC: 2.1 Async and Task
QUALIFIER: BEST
Q:
A method reads a paged remote API and must hand each record to the caller as soon as its page arrives. Which signature is the BEST fit?
OPT: a
`Task<List<Record>> GetAllAsync()` that fills and returns a list
WHY:
The task completes only after every page is loaded, so the caller gets nothing until the whole list is in memory.
OPT: b *
`async IAsyncEnumerable<Record> GetAllAsync()` using `yield return`, read with `await foreach`
OPT: c
`IEnumerable<Task<Record>> GetAll()` built with a synchronous iterator
WHY:
A synchronous iterator cannot await a page request, so it must block on each page or know the record count up front; it does not stream asynchronously.
OPT: d
`async Task<IEnumerable<Record>> GetAllAsync()` that uses `yield return`
WHY:
This does not compile: an async method returning `Task<IEnumerable<T>>` cannot be an iterator, because `yield return` needs an iterator return type.
A:
An async iterator returning `IAsyncEnumerable<Record>` awaits each page and yields its records as they arrive. The caller's `await foreach` processes them one by one, without blocking a thread or buffering the full result.
USAGE:
ASP.NET Core can also return `IAsyncEnumerable<T>` from an action, so large result sets stream instead of being loaded into one list.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/generate-consume-asynchronous-stream
The code that generates the sequence can now use yield return to return elements in a method that was declared with the async modifier. You can consume an async stream using an await foreach loop just as you consume any sequence using a foreach loop.

## net-async-07 | d2
TOPIC: 2.1 Async and Task
Q:
A controller action calls `_service.GetOrdersAsync().Result`. It works in testing, but under load response times climb and requests time out. What is happening, and what is the fix?
A:
Thread-pool starvation: every request blocks a pool thread while it waits for I/O. Blocked threads cannot run continuations or new requests, and the pool adds threads only slowly, so queues grow and latency climbs. Make the action `async`, return `Task<IActionResult>`, and `await` the call all the way down instead of using `.Result` or `.Wait()`.
USAGE:
The symptom is high latency with low CPU; one blocking call in a hot path can starve the whole server.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices?view=aspnetcore-8.0
A common performance problem in ASP.NET Core apps is blocking calls that could be asynchronous. Many synchronous blocking calls lead to Thread Pool starvation and degraded response times.

## net-async-08 | d2
TOPIC: 2.1 Async and Task
Q:
To "make it async", a teammate wraps a synchronous library call in `await Task.Run(() => legacy.Compute())` inside a controller action. Does that improve throughput, and why or why not?
A:
No. ASP.NET Core already runs the action on a thread-pool thread, so `Task.Run` just moves the work to another pool thread; one thread is still busy for the whole call, plus extra scheduling overhead. Call the synchronous method directly, or switch to a truly asynchronous API if the library offers one.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices?view=aspnetcore-8.0
Do not call Task.Run and immediately await it. ASP.NET Core already runs app code on normal Thread Pool threads, so calling Task.Run only results in extra unnecessary Thread Pool scheduling. Even if the scheduled code would block a thread, Task.Run does not prevent that.

## net-async-09 | d2
TOPIC: 2.1 Async and Task
Q:
Users often close the browser while a slow report endpoint is still querying the database, and the query keeps running. How do you make the work stop when the client disconnects?
A:
Add a `CancellationToken` parameter to the action and pass it to every async call, such as `ToListAsync(cancellationToken)`. MVC binds it to `HttpContext.RequestAborted`, which is signaled when the connection is aborted, so the database call is canceled and the request stops using resources. Expect an `OperationCanceledException` and do not log it as an error.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/mvc/models/model-binding?view=aspnetcore-8.0
Actions can optionally bind a CancellationToken as a parameter. This binds RequestAborted that signals when the connection underlying the HTTP request is aborted. Actions can use this parameter to cancel long running async operations that are executed as part of the controller actions.

## net-async-10 | d2
TOPIC: 2.1 Async and Task
Q:
A reviewer removed `async`/`await` here "to save a state machine". What can go wrong at run time, and what is the fix?
```csharp
Console.WriteLine(await ReadAllAsync("data.txt"));
Task<string> ReadAllAsync(string path)
{
    using var reader = new StreamReader(path);
    return reader.ReadToEndAsync();
}
```
A:
The reader is disposed as soon as the method returns its task, while the read may still be in progress, so it can fail with `ObjectDisposedException`. `using` disposes at method exit, and without `await` the method exits immediately. Mark it `async` and `return await reader.ReadToEndAsync();`, so disposal waits until the read completes.
USAGE:
Elide async/await only in pure pass-through methods with no `using` around the call.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using
A return inside a using block still guarantees disposal. The compiler rewrites it into a try/finally, so the resource’s Dispose is always called before the method actually returns.

## net-async-11 | d2
TOPIC: 2.1 Async and Task
Q:
An action returns 202 Accepted and starts `_ = Task.Run(...)` to send a confirmation email. Why is this fragile, and where should that work run instead?
A:
Nothing owns the task: its exceptions go unobserved, it can outlive the request's scoped services, and a shutdown or restart silently drops it. Hand the work to a hosted service, such as a `BackgroundService` that reads from a queue, because the host starts it, keeps it running for the app's lifetime and gives it a stopping token for graceful shutdown.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices?view=aspnetcore-8.0
Background tasks should be implemented as hosted services.

## net-async-12 | d2
TOPIC: 2.1 Async and Task
Q:
A reviewer asks you to switch every repository method from `Task<T>` to `ValueTask<T>` "because it's faster". What do you answer, and when is `ValueTask<T>` worth it?
A:
Keep `Task<T>` by default and switch only where profiling shows a benefit. `ValueTask<T>` saves an allocation only when the method often completes synchronously, such as a cache hit; a database call that really awaits I/O allocates anyway. Consumers must also follow stricter rules (await once, do not block on it), so a blanket switch adds risk without a measurable gain.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.valuetask-1?view=net-8.0
As such, the default choice for any asynchronous method should be to return a Task or Task<TResult>. Only if performance analysis proves it worthwhile should a ValueTask<TResult> be used instead of a Task<TResult>.

## net-async-13 | d2
TOPIC: 2.1 Async and Task
QUALIFIER: BEST
Q:
Your team maintains a NuGet client library used by WPF apps and ASP.NET Core services, and also writes ASP.NET Core controllers. Where does `ConfigureAwait(false)` BEST belong?
OPT: a
On every `await`, in both the library and the controllers
WHY:
Adding it to controllers is noise: ASP.NET Core has no SynchronizationContext to skip, so only the library awaits benefit.
OPT: b *
In the library's awaits; controllers can omit it
OPT: c
Only in the controllers, to speed up requests
WHY:
Controllers have no context to skip, so nothing speeds up, while the library stays exposed to UI contexts in WPF hosts.
OPT: d
Nowhere, since .NET Core removed SynchronizationContext
WHY:
Only ASP.NET Core lacks one; WPF and WinForms on .NET 8 still install a SynchronizationContext, so library continuations would queue to the UI thread.
A:
Put it in the library: it may run under a UI SynchronizationContext, and `ConfigureAwait(false)` stops its continuations from posting back to that context, avoiding needless UI-thread hops and sync-over-async deadlocks. ASP.NET Core app code has no context to capture, so it can omit it.
USAGE:
Enable analyzer rule CA2007 in library projects only; in app projects it just adds noise.
SOURCE: https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2007
This warning is intended for libraries, where the code may be executed in arbitrary environments and where code shouldn't make assumptions about the environment or how the caller of the method may be invoking or waiting on it.

## net-async-14 | d2
TOPIC: 2.1 Async and Task
Q:
What does this program print?
```csharp
var a = Fail("A");
var b = Fail("B");
var all = Task.WhenAll(a, b);
try { await all; }
catch (Exception ex) { Console.WriteLine($"{ex.Message} {all.Exception!.InnerExceptions.Count}"); }
static Task Fail(string m) => Task.FromException(new InvalidOperationException(m));
```
OPT: a *
`A 2`
OPT: b
`One or more errors occurred. (A) (B) 2`
WHY:
That is the AggregateException message, but `await` unwraps the faulted task and throws its first inner exception, not the aggregate.
OPT: c
`A 1`
WHY:
WhenAll waits for both tasks and stores both failures, so `all.Exception.InnerExceptions` holds two exceptions even though only one is thrown.
OPT: d
`B 2`
WHY:
Both tasks are already faulted when WhenAll sees them, and their exceptions are stored in the order the tasks were passed; `a` comes first, so A is thrown.
A:
`await` on a faulted `WhenAll` task rethrows only the first inner exception, so `ex.Message` is A, while `all.Exception` still holds both failures in an AggregateException; inspect it when you need every error. The output is `A 2`.
USAGE:
When logging failures of parallel calls, log `whenAllTask.Exception` too, or you silently lose every error but the first.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/consuming-the-task-based-asynchronous-pattern
In this case, if any asynchronous operation fails, all the exceptions are consolidated in an AggregateException exception, which is stored in the Task that is returned from the WhenAll method. However, only one of those exceptions is propagated by the await keyword.

## net-async-16 | d2
TOPIC: 2.1 Async and Task
QUALIFIER: BEST
Q:
You must call a rate-limited API for 5,000 IDs with at most 4 calls in flight at any time. Which approach is the BEST fit?
OPT: a
`await Task.WhenAll(ids.Select(id => CallAsync(id)))`
WHY:
It starts all 5,000 calls at once, so nothing limits how many are in flight and the rate limit is exceeded immediately.
OPT: b *
`Parallel.ForEachAsync` with `MaxDegreeOfParallelism = 4`
OPT: c
`Parallel.ForEach` with `MaxDegreeOfParallelism = 4` and an async lambda
WHY:
The async lambda becomes `async void`; each iteration ends at its first await, so far more than 4 calls run at once and exceptions are lost.
OPT: d
A `foreach` loop that awaits each call before the next
WHY:
It respects the limit but runs only one call at a time, so it takes about four times longer than the limit allows.
A:
`Parallel.ForEachAsync` with `ParallelOptions { MaxDegreeOfParallelism = 4 }` awaits each async body and starts the next ID only when one of the four finishes, so no more than four calls run at once. Without the option it defaults to the processor count.
USAGE:
Pass a CancellationToken in the same `ParallelOptions`, so a failing run or shutdown stops scheduling the remaining IDs.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.parallel.foreachasync?view=net-8.0
The operation will execute at most ProcessorCount operations in parallel.

## net-async-15 | d3
TOPIC: 2.1 Async and Task
Q:
(Choose two.) An async call inside a request handler must not hold the request for more than 2 seconds. Which two approaches enforce that limit without blocking a thread?
OPT: a *
`CancelAfter(TimeSpan.FromSeconds(2))` on a token source whose token goes to the call
OPT: b *
`await task.WaitAsync(TimeSpan.FromSeconds(2))`
OPT: c
`task.Wait(2000)`, then check the returned bool to detect a timeout
WHY:
Wait blocks the calling thread for up to two seconds, which is the sync-over-async pattern that starves the thread pool.
OPT: d
`Thread.Sleep(2000)`, then check `task.IsCompleted` before continuing
WHY:
It blocks a thread and waits the full two seconds even when the call finishes in 50 ms.
OPT: e
`await Task.Delay(2000)` before starting the call itself
WHY:
It only postpones the call by two seconds and puts no limit on how long the call itself runs.
A:
Both wait without blocking. `CancelAfter` cancels the token after 2 seconds, so a cancellable call aborts its work and throws `OperationCanceledException`. `WaitAsync` faults the awaiting side with `TimeoutException`, but the underlying operation keeps running; prefer the token when the API accepts one.
USAGE:
Link the timeout source to `RequestAborted` with `CreateLinkedTokenSource`, so either a timeout or a client disconnect stops the call.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.waitasync?view=net-8.0
The timeout after which the Task should be faulted with a TimeoutException if it hasn't otherwise completed.

## net-conc-01 | d1
TOPIC: 2.2 Concurrency and Thread Safety
Q:
Ten tasks each run `_count++` a thousand times on the same `int` field, and the final total often comes out below 10,000. Why, and what is the simplest fix?
A:
`_count++` is not atomic: it is a read, an add and a write, so two threads can read the same value and one increment overwrites the other. Replace it with `Interlocked.Increment(ref _count)`, which performs the whole read-modify-write as one atomic operation.
USAGE:
Request counters and statistics fields in singletons are where lost updates show up in production; Interlocked fixes them without a lock.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/threading/managed-threading-best-practices
In a multithreaded application, a thread that has loaded and incremented the value might be preempted by another thread which performs all three steps; when the first thread resumes execution and stores its value, it overwrites objCt without taking into account the fact that the value has changed in the interim. This particular race condition is easily avoided by using methods of the Interlocked class, such as Interlocked.Increment.

## net-conc-02 | d2
TOPIC: 2.2 Concurrency and Thread Safety
Q:
Why does this code fail to compile, and how do you protect an async critical section instead?
```csharp
var gate = new object();
await WriteAsync(Stream.Null, new byte[] { 1 });
async Task WriteAsync(Stream s, byte[] data)
{
    lock (gate)
    {
        await s.WriteAsync(data);
    }
}
```
A:
It fails with CS1996 because `await` is not allowed inside a `lock` body. A `Monitor` lock belongs to the thread that took it, but code after `await` can resume on another thread, which could not release it. Use a `SemaphoreSlim(1, 1)`: `await _sem.WaitAsync()` before the section and `_sem.Release()` in a `finally`, so callers wait without blocking a thread and the semaphore has no thread affinity.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock
You can't use the await expression in the body of a lock statement.

## net-conc-03 | d2
TOPIC: 2.2 Concurrency and Thread Safety
Q:
Under load, the logs show `LoadExpensive` running twice for the same key. Why, and how do you make it run once per key?
```csharp
using System.Collections.Concurrent;
class ReportCache
{
    private readonly ConcurrentDictionary<string, Report> _cache = new();
    public Report Get(string key) => _cache.GetOrAdd(key, k => LoadExpensive(k));
    private static Report LoadExpensive(string key) => new Report(key);
}
record Report(string Key);
```
A:
`GetOrAdd` runs the value factory outside its locks, so two threads that miss the same key together can both call `LoadExpensive`. Only one value is stored and both callers get it, but the expensive work ran twice. Store `Lazy<Report>` values instead: `_cache.GetOrAdd(key, k => new Lazy<Report>(() => LoadExpensive(k))).Value`; losing `Lazy` wrappers are cheap and discarded, and the stored one runs the load once.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.collections.concurrent.concurrentdictionary-2.getoradd?view=net-8.0
Since a key/value can be inserted by another thread while valueFactory is generating a value, you cannot trust that just because valueFactory executed, its produced value will be inserted into the dictionary and returned. If you call GetOrAdd simultaneously on different threads, valueFactory may be called multiple times, but only one key/value pair will be added to the dictionary.

## net-conc-04 | d2
TOPIC: 2.2 Concurrency and Thread Safety
Q:
A teammate wraps 200 HTTP calls in `Parallel.ForEach`, each calling `client.GetStringAsync(url).Result`, to speed them up. Why is that the wrong tool, and what do you use instead?
A:
`Parallel.ForEach` is meant for CPU-bound work; with I/O it just parks thread-pool threads on `.Result` while they wait for the network. Those threads do nothing but block, and the pool has to grow to keep up, which wastes threads and can starve the app. Start the requests as tasks and `await Task.WhenAll(tasks)`, so the waits overlap and no thread is held while responses are in flight.
USAGE:
Say "parallelism is for computation, asynchrony is for waiting"; mixing them up shows as high thread counts with idle CPUs.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-scenarios
Use the async modifier and await expression without the Task.Run method. Avoid using the Task Parallel Library.

## net-conc-05 | d2
TOPIC: 2.2 Concurrency and Thread Safety
QUALIFIER: BEST
Q:
Request handlers enqueue jobs that a single `BackgroundService` processes. Once 100 jobs are pending, producers must wait without blocking a thread. Which structure is the BEST fit?
OPT: a
`BlockingCollection<Job>` created with a bounded capacity of 100
WHY:
Its `Add` blocks the calling thread when the collection is full, so every waiting request handler holds a thread-pool thread, which is exactly what the requirement rules out.
OPT: b *
`Channel.CreateBounded<Job>(100)` with producers calling `WriteAsync`
OPT: c
A `ConcurrentQueue<Job>` that the service polls with `await Task.Delay`
WHY:
The queue has no capacity limit, so producers are not made to wait at 100, and polling adds latency and wakes the service when there is nothing to do.
OPT: d
A `List<Job>` guarded by `lock`, producers checking `Count` first
WHY:
`lock` blocks threads, and checking `Count` gives producers no way to wait asynchronously for space; they would have to spin, sleep or reject the job.
A:
`Channel.CreateBounded<Job>(100)` fits: in the default `Wait` full mode, `WriteAsync` returns an incomplete task while the channel is full, so producers wait asynchronously without holding a thread, and the service drains it with `ReadAllAsync`.
USAGE:
Queued background work in ASP.NET Core: a bounded channel gives back pressure instead of letting an unbounded queue grow until memory runs out.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/channels
When you create a bounded channel, the channel is bound to a maximum capacity. When the bound is reached, the default behavior is that the channel asynchronously blocks the producer until space becomes available.

## net-conc-06 | d2
TOPIC: 2.2 Concurrency and Thread Safety
QUALIFIER: BEST
Q:
An `Account` class guards its private `_balance` field with a `lock` statement in `Debit` and `Credit`. On .NET 8, which lock target is the BEST choice?
OPT: a
`lock (this)`, since the lock guards this instance's own state
WHY:
Any code holding a reference to the account can lock the same object, so outside callers can contend with or deadlock against the class's internal lock.
OPT: b
`lock (typeof(Account))`, so every instance shares one gate
WHY:
The `Type` object is reachable from any code through `typeof` or reflection, and one lock for all accounts serializes unrelated instances.
OPT: c *
A `private readonly object _balanceLock = new();` field
OPT: d
A `"balance"` string literal kept in a private constant
WHY:
String literals are interned, so every class that locks the same text shares one object, causing unrelated contention or deadlocks.
A:
A private readonly `object` field used only for this lock: outside code cannot reach it, so nothing else can take the same lock. `this`, `Type` objects and interned strings are reachable from other code, which can cause contention or deadlock.
USAGE:
Say "lock on something only this class can see"; a publicly reachable lock target is how two components deadlock each other.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock
If you're using an older version of .NET and C#, lock on a dedicated object instance that isn't used for another purpose. Avoid using the same lock object instance for different shared resources, as it might result in deadlock or lock contention.

## net-gc-01 | d1
TOPIC: 3.1 GC and IDisposable
Q:
.NET has a garbage collector, so why do you still have to call `Dispose` on a `FileStream` instead of letting the GC clean it up?
A:
Because the GC only reclaims managed memory and knows nothing about `Dispose`, so the OS file handle stays open until you dispose the stream. Without `using`, the file can stay locked until a finalizer happens to run at some unpredictable later time, and other code trying to open it fails.
USAGE:
Say "the GC manages memory, `Dispose` manages resources"; a locked file or exhausted connection pool is the typical production symptom.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/using-objects
The GC does not dispose your objects, as it has no knowledge of IDisposable.Dispose() or IAsyncDisposable.DisposeAsync(). The GC only knows whether an object is finalizable (that is, it defines an Object.Finalize() method), and when the object's finalizer needs to be called.

## net-gc-02 | d1
TOPIC: 3.1 GC and IDisposable
Q:
Short-lived `Dashboard` objects each run `feed.PriceChanged += OnPrice;` on a singleton price feed and are then dropped without unsubscribing. Why does memory keep growing even though nothing else references them?
A:
The singleton's event still holds a delegate that points to each `Dashboard`, so every subscriber stays reachable and the GC cannot collect it. Unsubscribe with `feed.PriceChanged -= OnPrice;` (for example in `Dispose`) when the subscriber is done.
USAGE:
A classic managed leak: long-lived publisher plus short-lived subscribers; a memory dump shows the dashboards rooted through the feed's event delegate.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/events/how-to-subscribe-to-and-unsubscribe-from-events
Until you unsubscribe from an event, the multicast delegate that underlies the event in the publishing object has a reference to the delegate that encapsulates the subscriber's event handler. As long as the publishing object holds that reference, garbage collection will not delete your subscriber object.

## net-gc-03 | d1
TOPIC: 3.1 GC and IDisposable
Q:
Why does the .NET GC split the managed heap into generations 0, 1 and 2 instead of examining the whole heap on every collection?
A:
Because most objects die young, so collecting only generation 0 frees most garbage at a fraction of the cost of a full-heap collection. Objects that survive are promoted to older generations, which are collected far less often.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals
Garbage collection primarily occurs with the reclamation of short-lived objects. To optimize the performance of the garbage collector, the managed heap is divided into three generations, 0, 1, and 2, so it can handle long-lived and short-lived objects separately.

## net-gc-04 | d1
TOPIC: 3.1 GC and IDisposable
Q:
What does this program print?
```csharp
Load();
Console.WriteLine("after");
static void Load()
{
    using var r = new Res();
    Console.WriteLine("reading");
}
class Res : IDisposable { public void Dispose() => Console.WriteLine("dispose"); }
```
OPT: a *
reading, dispose, after
OPT: b
reading, after (Dispose waits until the GC collects r)
WHY:
`Dispose` is called by a compiler-generated `finally`, not by the GC; the GC never calls `Dispose` at all.
OPT: c
dispose, reading, after
WHY:
The `using` declaration only creates the object at that line; disposal happens when the variable's scope ends, after "reading" is printed.
OPT: d
reading, after, dispose
WHY:
The scope of `r` is the body of `Load`, not the whole program, so it is disposed when `Load` returns, before "after" is printed.
A:
It prints reading, dispose, after on three lines: a `using` declaration disposes the variable at the end of its enclosing scope, here when `Load` returns, so `Dispose` runs before the caller prints "after".
USAGE:
A `using var` at the top of a long method holds the connection or file until the method ends; use a braced block to release it earlier.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using
When declared in a using declaration, a local variable is disposed at the end of the scope in which it's declared.

## net-gc-05 | d1
TOPIC: 3.1 GC and IDisposable
QUALIFIER: BEST
Q:
A teammate adds `GC.Collect()` at the end of every API request "to keep memory low". What is the BEST review comment?
OPT: a *
Remove it: each call forces a blocking collection of all generations, and the GC already decides when to collect.
OPT: b
Keep it, but change it to `GC.Collect(0)` so only the short-lived request objects are collected.
WHY:
It still induces a GC on every request, pausing threads; generation 0 is already collected automatically whenever its allocation budget fills.
OPT: c
Keep it, and add `GC.WaitForPendingFinalizers()` so the request's disposable objects get cleaned up too.
WHY:
The GC never calls `Dispose`; waiting for finalizers only blocks the request longer and still leaves undisposed resources open.
OPT: d
Replace it by setting every local variable to `null` at the end of the action so the GC frees that memory immediately.
WHY:
Nulling a reference frees nothing by itself; memory is reclaimed only when a collection runs, and the request's objects become unreachable when the action returns anyway.
A:
Remove the call: `GC.Collect()` performs a blocking collection of all generations, so every request pays a full-GC pause and live objects get promoted needlessly, while the self-tuning GC already collects when allocation budgets fill.
USAGE:
Under load, per-request GC.Collect shows up as high "% time in GC" and latency spikes in dotnet-counters; deleting it is the fix.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.gc.collect?view=net-8.0
Use this method to try to reclaim all memory that is inaccessible. It performs a blocking garbage collection of all generations.

## net-gc-06 | d2
TOPIC: 3.1 GC and IDisposable
Q:
An API allocates a new 200 KB `byte[]` buffer per request, and `dotnet-counters` shows frequent generation 2 collections. Why, and what would you change?
A:
Each 200 KB array exceeds the 85,000-byte threshold, so it lands on the large object heap, which is collected only together with generation 2. Churning temporary large buffers keeps exceeding the LOH budget, so the GC runs expensive gen 2 collections that free little else. Rent buffers from `ArrayPool<byte>.Shared` and return them in `finally`, so no new large object is allocated per request.
USAGE:
Mention LOH allocation plus pooling: interviewers expect `ArrayPool<T>` or `RecyclableMemoryStream` as the fix for per-request large buffers.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/large-object-heap
Because the LOH and generation 2 are collected together, if either one's threshold is exceeded, a generation 2 collection is triggered. If a generation 2 collection is triggered because of the LOH, generation 2 won't necessarily be much smaller after the GC.

## net-gc-07 | d2
TOPIC: 3.1 GC and IDisposable
Q:
A colleague adds an empty finalizer `~ReportBuilder() { }` "just to be safe" to a class that holds only managed objects. What does it cost, and what should the class do instead?
A:
Delete it: it adds no safety and costs performance. Every finalizable instance is registered for finalization, so when it becomes unreachable it survives a collection and is promoted until the finalizer thread runs, keeping memory alive longer and adding GC work. If the class owns disposable fields, implement `IDisposable` without a finalizer and dispose them there.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/finalizers
This queue is processed by the garbage collector. When the GC processes the queue, it calls each finalizer. Unnecessary finalizers, including empty finalizers, finalizers that only call the base class finalizer, or finalizers that only call conditionally emitted methods, cause a needless loss of performance.

## net-gc-08 | d2
TOPIC: 3.1 GC and IDisposable
Q:
A long-running service's memory grows until `OutOfMemoryException`, although the GC runs regularly. What in this class causes it?
```csharp
public class PriceService
{
    private static readonly Dictionary<string, decimal[]> _history = new();
    public decimal[] GetHistory(string sku)
    {
        if (!_history.TryGetValue(sku, out var prices))
            _history[sku] = prices = new decimal[10_000]; // loaded from the DB
        return prices;
    }
}
```
A:
The static dictionary is a GC root for the life of the process and never evicts, so every SKU's array stays reachable and the GC cannot reclaim it. A collector only frees unreachable objects, so this "cache" grows without bound. Use a bounded cache with eviction, such as `IMemoryCache` with a `SizeLimit` and expiration.
USAGE:
Say "the GC frees unreachable objects, not unused ones"; unbounded static caches are the most common managed leak in services.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/diagnostics/debug-memory-leak
Memory can leak when your app references objects that it no longer needs to perform the desired task. Referencing these objects prevents the garbage collector from reclaiming the memory used. That can result in performance degradation and an OutOfMemoryException exception being thrown.

## net-gc-09 | d2
TOPIC: 3.1 GC and IDisposable
QUALIFIER: BEST
Q:
You run hundreds of instances of a small app on the same few-core hosts. They use server GC, and you see heavy context switching during collections. Which GC setting is the BEST fit?
OPT: a
Keep server GC, so each process gets its own heap and GC thread per logical CPU
WHY:
That is the cause: hundreds of processes each running per-CPU GC threads collect at the same time and fight for the same few cores.
OPT: b *
Workstation GC with concurrent (background) GC disabled
OPT: c
Workstation GC with concurrent (background) GC enabled for shorter pauses
WHY:
Background GC adds an extra GC thread to every process, which means more threads to schedule; the guidance for this scenario is to disable concurrent GC.
OPT: d
Server GC plus a timer that calls `GC.Collect()` in each instance every few seconds
WHY:
Induced blocking full collections add GC work, and each one still runs server GC's per-CPU threads, so context switching gets worse.
A:
Workstation GC with concurrent GC disabled: each process then collects on the thread that triggered the GC instead of waking a high-priority GC thread per CPU, so hundreds of processes stop competing for the same cores. Set `ServerGarbageCollection` and `ConcurrentGarbageCollection` to `false` in the project file.
USAGE:
ASP.NET Core apps default to server GC; dense container or multi-tenant hosts are where switching to workstation GC pays off.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/workstation-server-gc
If you're running hundreds of instances of an application, consider using workstation garbage collection with concurrent garbage collection disabled. This will result in less context switching, which can improve performance.

## net-gc-10 | d2
TOPIC: 3.1 GC and IDisposable
QUALIFIER: BEST
Q:
Why does this not compile, and what is the BEST fix?
```csharp
sealed class AuditSink : IAsyncDisposable { public ValueTask DisposeAsync() => default; }
static class Audit
{
    public static async Task WriteAsync()
    {
        using var sink = new AuditSink();
        await Task.Yield();
    }
}
```
OPT: a *
`AuditSink` implements only `IAsyncDisposable`, so declare it with `await using var sink` in the async method.
OPT: b
`DisposeAsync` must be declared `async`; write `public async ValueTask DisposeAsync()` and keep `using`.
WHY:
How `DisposeAsync` is written does not matter; the error is that a plain `using` requires an `IDisposable` type, which `AuditSink` is not.
OPT: c
Replace `using` with `try/finally` that calls `sink.DisposeAsync().AsTask().Wait()`.
WHY:
It compiles, but it is sync-over-async: it blocks a thread-pool thread while waiting, inside a method that can simply await.
OPT: d
A `using` declaration needs braces; switch to a `using (var sink = ...) { }` block.
WHY:
The block form has the same requirement: a plain `using` statement still needs an `IDisposable`, so it fails with the same error.
A:
Plain `using` only accepts `IDisposable`, and `AuditSink` implements only `IAsyncDisposable` (error CS8418). Writing `await using var sink = new AuditSink();` makes the compiler await `DisposeAsync()` at the end of the scope, without blocking a thread.
USAGE:
Types such as `Utf8JsonWriter` or EF Core's `DbContext` support async disposal; prefer `await using` for them in async code.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-disposeasync
To properly consume an object that implements the IAsyncDisposable interface, you use the await and using keywords together.

## net-bcl-01 | d1
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
A service creates a new `HttpClient` inside a `using` block for every outgoing call. Under heavy load, calls start failing with socket errors. What is going wrong, and what is the basic fix?
A:
Port exhaustion: every new client opens its own connection, and each closed connection keeps its TCP port in TIME-WAIT, so a high request rate uses up the operating system's ports. Reuse `HttpClient` instances across requests (a long-lived client or `IHttpClientFactory`) so connections come from a pool instead of being opened and torn down per call.
USAGE:
Disposing an IDisposable looks correct here, which is why this bug survives code review; say "the connection pool lives with the client's handler".
SOURCE: https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines
If the rate of requests is high, the operating system limit of available ports might be exhausted. To avoid port exhaustion problems, reuse HttpClient instances for as many HTTP requests as possible.

## net-bcl-02 | d1
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
New .NET 8 code downloads a file with `new WebClient()`, and the build shows warning SYSLIB0014. What is the warning telling you, and what should the code use instead?
A:
`WebClient`, like `WebRequest` and `HttpWebRequest`, has been obsolete since .NET 6; new code should use `HttpClient`. The old types stay only for compatibility and get no new work, so suppressing the warning just postpones a migration you will have to do anyway.
SOURCE: https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib0014
The following APIs are marked as obsolete, starting in .NET 6. Using them in code generates warning SYSLIB0014 at compile time.

## net-bcl-03 | d1
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
Servers in different time zones write order timestamps that are later compared with each other. Why is `DateTimeOffset` a safer column type than a local `DateTime`?
A:
A `DateTimeOffset` stores the offset from UTC together with the clock reading, so each value identifies one exact instant regardless of which server wrote it. A local `DateTime` holds only the clock reading, so 09:00 in Berlin and 09:00 in New York look equal and compare wrongly.
USAGE:
Add that an offset is not a time zone: it fixes the instant but not future daylight-saving rules.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/datetime/choosing-between-datetime
The DateTimeOffset structure represents a date and time value, together with an offset that indicates how much that value differs from UTC. Thus, the value always unambiguously identifies a single point in time.

## net-bcl-04 | d2
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
A service sends all calls through one static `HttpClient` created at startup. Under steady traffic, after the API's DNS record moves to a new IP, the app keeps calling the old address. Why, and how do you fix it while keeping the shared client?
A:
Set `PooledConnectionLifetime` on a `SocketsHttpHandler` for the shared client. `HttpClient` resolves DNS only when it opens a connection and ignores DNS TTLs, and the default lifetime is infinite, so busy pooled connections to the old IP stay open; with a lifetime set, each connection is closed after that interval and its replacement re-resolves the name.
CODE: csharp
static class Http
{
    public static readonly HttpClient Shared = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2)
    });
}
USAGE:
Pick the lifetime from how often DNS changes in your environment; the docs use 2 minutes as an example.
SOURCE: https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines
If DNS entries change regularly, which can happen in some scenarios, the client won't respect those updates. To solve this issue, limit the lifetime of the connection by setting the PooledConnectionLifetime property, so that DNS lookup is repeated when the connection is replaced.

## net-bcl-06 | d2
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
A .NET 8 retry job injects `TimeProvider` and reads `GetUtcNow()` from it, but waits between attempts with `Task.Delay(TimeSpan.FromMinutes(5))`. Why is that inconsistent, and what should it call instead?
A:
It should call `Task.Delay(delay, timeProvider)`, because the plain overload always runs on the real system timer and ignores the injected provider. Since .NET 8, timer-based APIs such as `Task.Delay`, `Task.WaitAsync` and the `CancellationTokenSource(TimeSpan, TimeProvider)` constructor accept a `TimeProvider`, so waits and timeouts follow the same clock as `GetUtcNow`; otherwise a substituted provider controls "now" but not when the wait ends.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview
The following methods related to asynchronous programming work with TimeProvider: CancellationTokenSource(TimeSpan, TimeProvider) Task.Delay(TimeSpan, TimeProvider)

## net-bcl-11 | d2
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
A .NET Framework plugin host isolates each plugin with `AppDomain.CreateDomain`. After porting to .NET 8, that call throws `PlatformNotSupportedException`. What should the host use instead, and when is that not enough?
A:
Load each plugin into its own `AssemblyLoadContext`, and move plugins into a separate process when you need real isolation. .NET 8 cannot create extra app domains; an `AssemblyLoadContext` gives each plugin its own dependency versions and, if collectible, can be unloaded, but it shares the host's memory and permissions, so a crashing or untrusted plugin needs a process boundary.
USAGE:
Unloading needs a collectible context and no lingering references to plugin types; one static event subscription can keep the whole context alive.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/porting/net-framework-tech-unavailable
Creating more app domains isn't supported, and there are no plans to add this capability in the future. For code isolation, use separate processes or containers as an alternative. To dynamically load assemblies, use the AssemblyLoadContext class.

## net-bcl-07 | d2
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
What does this console app print?
```csharp
using System.Text.Json;
var json = """{"name":"Ada","age":36}""";
var p = JsonSerializer.Deserialize<Person>(json)!;
Console.WriteLine($"{p.Name ?? "null"} {p.Age}");
public class Person
{
    public string? Name { get; set; }
    public int Age { get; set; }
}
```
OPT: a *
null 0
OPT: b
Ada 36
WHY:
That is Newtonsoft.Json or ASP.NET Core behavior; plain `JsonSerializer` with no options matches property names case-sensitively, so "name" does not bind to `Name`.
OPT: c
A `JsonException` is thrown
WHY:
JSON properties that match no .NET property are ignored by default rather than rejected, so deserialization succeeds and simply leaves both properties at their defaults.
OPT: d
A `NullReferenceException` is thrown
WHY:
`Deserialize` still creates a `Person` for a JSON object even when no property matches, so `p` is not null and the line prints normally.
A:
It prints "null 0". System.Text.Json matches property names case-sensitively by default, so "name" and "age" match nothing and both properties keep their defaults. ASP.NET Core differs only because it applies web defaults; elsewhere pass `new JsonSerializerOptions(JsonSerializerDefaults.Web)` or set `PropertyNameCaseInsensitive`.
USAGE:
Bites when a background worker or test deserializes the same payload a controller binds fine; no error, just silent defaults.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/migrate-from-newtonsoft
During deserialization, Newtonsoft.Json does case-insensitive property name matching by default. The System.Text.Json default is case-sensitive, which gives better performance since it's doing an exact match.

## net-bcl-08 | d2
TOPIC: 3.2 BCL: HttpClient, JSON, Time
QUALIFIER: BEST
Q:
Profiling shows JSON serialization dominating CPU. The helper builds `new JsonSerializerOptions(JsonSerializerDefaults.Web)` inside the method on every call. Which change is BEST while keeping the JSON output identical?
OPT: a *
Store one Web-defaults instance in a `static readonly` field and reuse it
OPT: b
Keep creating options per call but call `MakeReadOnly()` on each one before serializing
WHY:
Freezing only makes each instance immutable; every call still allocates a new options object and must find its metadata again, with no guarantee of a warm cache, so it is not the same as reusing one instance.
OPT: c
Pass `JsonSerializerOptions.Default`, an instance the library already caches and shares across calls
WHY:
`Default` uses general defaults, not web defaults: PascalCase names and case-sensitive matching, so the JSON output and binding behavior change.
OPT: d
Copy a shared template with `new JsonSerializerOptions(template)` at the start of each call
WHY:
Each call still allocates a copy and relies on runtime cache matching for its metadata; the docs say using the copy constructor is not the same as reusing an existing instance.
A:
Keep one Web-defaults instance in a `static readonly` field. The docs say to reuse one instance rather than create options per call; a per-call instance pays for allocation and a cache lookup, and nothing guarantees it finds warm metadata. The shared instance is thread-safe and immutable after first use.
USAGE:
On .NET 8 you build the web-defaults instance yourself with the JsonSerializerDefaults.Web constructor; keep it in one static field.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/configure-options
If you use JsonSerializerOptions repeatedly with the same options, don't create a new JsonSerializerOptions instance each time you use it. Reuse the same instance for every call.

## net-bcl-09 | d2
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
A console tool suppressed the `BinaryFormatter` obsoletion error and worked on .NET 7. After retargeting to .NET 8 with no other change, what happens when it calls `BinaryFormatter.Serialize`?
OPT: a *
It throws `NotSupportedException` when `Serialize` is called
OPT: b
It runs normally; the runtime block applies only to ASP.NET Core, WASM and MAUI apps
WHY:
That was the .NET 7 rule. In .NET 8 the runtime block covers every project type, console apps included, except Windows Forms and WPF.
OPT: c
It throws `MissingMethodException` because the type was removed from .NET 8
WHY:
The type still ships in .NET 8; removal is a later stage of the obsoletion plan. The methods exist and are found, they just throw when called.
OPT: d
It runs, because suppressing the obsoletion error also re-enables the methods
WHY:
Suppressing the diagnostic only silences the compiler. The runtime check is separate and is lifted only by a compatibility switch in the project file.
A:
It throws `NotSupportedException` at runtime. In .NET 8 the serialize and deserialize methods are disabled in every project type except Windows Forms and WPF; only the `EnableUnsafeBinaryFormatterSerialization` project switch brings them back. The real fix is migrating to a safe serializer such as System.Text.Json, because BinaryFormatter is insecure.
USAGE:
Bites on framework upgrades: the build is green because the error was suppressed, and the failure appears only in production.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/compatibility/serialization/8.0/binaryformatter-disabled
Starting in .NET 8, the affected methods throw a NotSupportedException at runtime across all project types except Windows Forms and WPF.

## net-bcl-10 | d2
TOPIC: 3.2 BCL: HttpClient, JSON, Time
QUALIFIER: BEST
Q:
A .NET 8 minimal API is published with Native AOT. It serializes DTOs through plain `JsonSerializer` calls, and some responses fail at runtime although everything works under `dotnet run`. Which fix is BEST?
OPT: a *
Add a `partial` `JsonSerializerContext` with `[JsonSerializable]` for the DTOs and serialize through it
OPT: b
Replace System.Text.Json with Newtonsoft.Json, which handles any type without extra setup
WHY:
Newtonsoft.Json is also reflection-based and is not AOT-safe, so the same failures move to another library and you lose the source generator.
OPT: c
Cache one reflection-based `JsonSerializerOptions` instance in a `static readonly` field
WHY:
Caching saves rebuilding metadata, but the metadata is still produced through reflection, which is exactly what Native AOT does not fully support.
OPT: d
Set `PropertyNameCaseInsensitive = true` so DTO properties bind regardless of name casing
WHY:
Casing changes which properties match, not how the serializer obtains type metadata; the reflection path is what fails under Native AOT.
A:
Use a source-generated `JsonSerializerContext` with `[JsonSerializable]` for each DTO. The generator emits the type metadata at compile time, so nothing depends on reflection, which Native AOT does not fully support; the failures appeared only after publishing because `dotnet run` uses CoreCLR, where reflection works.
USAGE:
In a minimal API, register the context with ConfigureHttpJsonOptions via TypeInfoResolverChain so endpoint results use it too.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation
Because System.Text.Json uses reflection by default, calling a basic serialization method can break Native AOT apps, which doesn't support all required reflection APIs. These breaks can be challenging to diagnose since they can be unpredictable, and apps are often debugged using the CoreCLR runtime, where reflection works.

## net-bcl-05 | d3
TOPIC: 3.2 BCL: HttpClient, JSON, Time
Q:
With this registration, `PriceCache` keeps calling the catalog service's old IP after a blue-green deploy, even though `AddHttpClient` is used. Why, and what is one fix?
```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient<CatalogClient>();
builder.Services.AddSingleton<PriceCache>();
public sealed class PriceCache(CatalogClient catalog)
{
    public Task<decimal> GetPriceAsync(int id) => catalog.GetPriceAsync(id);
}
```
A:
The singleton captures one transient `CatalogClient` forever, so its `HttpClient` stays bound to the handler it got at creation and the factory's handler recycling never reaches it. Once a typed client is created, the factory has no control over it, so its pooled connections to the old IP are never replaced. Fix: inject `IHttpClientFactory` into `PriceCache` and create a named client per operation.
USAGE:
Captive dependency again: a short-lived service held by a long-lived one keeps its stale state.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory
As soon as a typed client instance is created, IHttpClientFactory has no control over it. If a typed client instance is captured in a singleton, it may prevent it from reacting to DNS changes, defeating one of the purposes of IHttpClientFactory.

## asp-host-01 | d1
TOPIC: 4.1 Hosting, Configuration and Options
Q:
You create a new .NET 8 Web API and find only `Program.cs`, no `Startup.cs`. Is something missing, and could you still use a `Startup` class if your team prefers one?
A:
Nothing is missing: since .NET 6 the minimal hosting model merges the old `Startup.cs` into `Program.cs`, and a `Startup` class remains supported but optional. Services go on `builder.Services` and the pipeline on `app`; if you want a `Startup`, instantiate it in `Program.cs` and call its methods yourself.
USAGE:
When migrating an older app, say you can keep the existing Startup and call it from Program.cs, then inline it later.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/migration/50-to-60?view=aspnetcore-8.0
Using Startup and the Generic Host used by the ASP.NET Core 3.1 and 5.0 templates is fully supported.

## asp-host-02 | d1
TOPIC: 4.1 Hosting, Configuration and Options
Q:
A container sets `DOTNET_ENVIRONMENT=Staging` and `ASPNETCORE_ENVIRONMENT=Production` for an app built with `WebApplication.CreateBuilder`. Which environment does the app report, and why?
A:
It reports Staging. With `WebApplication`, `DOTNET_ENVIRONMENT` takes precedence over `ASPNETCORE_ENVIRONMENT`, so the app loads `appsettings.Staging.json`; the older `WebHost` gives `ASPNETCORE_ENVIRONMENT` priority instead.
USAGE:
When a container behaves like the wrong environment, list every *_ENVIRONMENT variable the image and orchestrator set, not just one.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/environments?view=aspnetcore-8.0
When using WebApplication, the DOTNET_ENVIRONMENT value take precedence over ASPNETCORE_ENVIRONMENT. When using WebHost, ASPNETCORE_ENVIRONMENT takes precedence.

## asp-host-03 | d1
TOPIC: 4.1 Hosting, Configuration and Options
Q:
A teammate proposes keeping the production database password in `dotnet user-secrets` on the server, because that keeps it out of `appsettings.json`. Why is that the wrong tool?
A:
Secret Manager is a development-only convenience: it stores secrets as plain, unencrypted JSON in the user profile, and the default host loads it only in the Development environment. Production secrets belong in a real secret store such as Azure Key Vault, or in environment variables set by the platform.
USAGE:
Say "user secrets keep secrets out of source control, not safe at rest".
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets?view=aspnetcore-8.0
Secret Manager doesn't encrypt the stored secrets and shouldn't be treated as a trusted store. It's for development purposes only.

## asp-host-04 | d1
TOPIC: 4.1 Hosting, Configuration and Options
Q:
A container's Bash entrypoint must export a variable overriding `Logging:LogLevel:Default`. Which variable name works?
OPT: a
`Logging:LogLevel:Default`
WHY:
Bash does not accept a colon in a variable name, so the script cannot export it; the colon form is not portable across platforms.
OPT: b
`Logging_LogLevel_Default`
WHY:
A single underscore is not a separator; the provider reads it as one flat key with underscores, which matches no section.
OPT: c *
`Logging__LogLevel__Default`
OPT: d
`Logging.LogLevel.Default`
WHY:
Bash also rejects a dot in a variable name, and even where a dot is allowed the provider does not treat it as a separator.
A:
`Logging__LogLevel__Default` works: the double underscore is valid in every shell, and the environment variables provider replaces each `__` with `:` when it reads the variable.
USAGE:
Kubernetes manifests and Azure App Service settings on Linux use the same `__` form, such as `ConnectionStrings__Default`.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/?view=aspnetcore-8.0
The colon (:) separator doesn't work with environment variable hierarchical keys on all platforms. For example, Bash doesn't support colon (:) as a separator. All platforms support the double underscore (__) syntax and automatically replace it with a colon (:).

## asp-host-05 | d2
TOPIC: 4.1 Hosting, Configuration and Options
Q:
What does this call write to the log, and why?
```csharp
var apples = 1;
var pears = 2;
var bananas = 3;
logger.LogInformation("{Pears}, {Bananas}, {Apples}", apples, pears, bananas);
```
A:
It writes `1, 2, 3`: `{Pears}` receives `apples`. Arguments fill placeholders by position, not by matching names, so the structured field `Pears` stores the apple count, and every query on that field is silently wrong.
USAGE:
In code review, check that argument order matches placeholder order; the compiler and the logger never flag a mismatch.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/logging/?view=aspnetcore-8.0
The order of the parameters, not their placeholder names, determines which parameters are used to provide placeholder values in log messages.

## asp-host-06 | d2
TOPIC: 4.1 Hosting, Configuration and Options
Q:
An options class has `[Required]` properties and is registered with `ValidateDataAnnotations`, yet a missing setting only fails when the first request reads the options. How do you make the app refuse to start instead?
A:
Chain `ValidateOnStart()` after `ValidateDataAnnotations()`. Without it, validation runs lazily the first time something reads `.Value`, so a bad deployment looks healthy until a request hits it. With it, the host validates while starting and throws `OptionsValidationException`, so the rollout fails fast and visibly.
CODE: csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOptions<SmtpOptions>()
    .BindConfiguration(SmtpOptions.Section)
    .ValidateDataAnnotations()
    .ValidateOnStart();
USAGE:
Pair it with deployment health checks: a misconfigured instance never starts, so it never takes traffic.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/options
The validation occurs at runtime, but you can configure it to occur at startup by instead chaining a call to ValidateOnStart:

## asp-host-07 | d2
TOPIC: 4.1 Hosting, Configuration and Options
Q:
An operator edits a value in `appsettings.json` on a running server, but a controller that injects `IOptions<FeatureOptions>` keeps returning the old value. Why, and what should it inject so each request sees one consistent, freshly bound value?
A:
`IOptions<T>` is a singleton whose value is built once and cached for the app's lifetime, so a reloaded file never reaches it. Inject `IOptionsSnapshot<FeatureOptions>`: it is scoped and rebound once per request, so the next request sees the edit and the value cannot change mid-request, as `IOptionsMonitor<T>.CurrentValue` can.
USAGE:
Mention the trade-off: the snapshot rebinds the options for every request, a small cost you pay only where reload matters.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options?view=aspnetcore-8.0
For the preceding code, changes to the JSON configuration in the app settings file after the app has started are not read. To read changes after the app has started, use IOptionsSnapshot.

## asp-host-08 | d2
TOPIC: 4.1 Hosting, Configuration and Options
QUALIFIER: BEST
Q:
A singleton `PriceCache` must keep its cached data for the app's lifetime and pick up `CacheOptions` changes while running. It currently injects `IOptionsSnapshot<CacheOptions>`. Which change is the BEST fix?
OPT: a
Inject `IOptions<CacheOptions>` instead, since it is a singleton too
WHY:
The lifetimes match, but `IOptions<T>` is computed once and never rereads configuration, so the cache keeps the startup values.
OPT: b
Register `PriceCache` as transient so it can consume the snapshot
WHY:
A transient instance is recreated on every resolution, so the cached data the service exists to hold is thrown away.
OPT: c *
Inject `IOptionsMonitor<CacheOptions>` and read `CurrentValue`
OPT: d
Keep the snapshot; the container hands each request a fresh copy
WHY:
A singleton is constructed once, so its dependencies are captured once; in Development, scope validation even rejects resolving the scoped snapshot from the root provider.
A:
Inject `IOptionsMonitor<CacheOptions>`: it is registered as a singleton, so a singleton may depend on it, and `CurrentValue` always returns the latest configuration. `IOptionsSnapshot<T>` is scoped, which makes it a captive dependency in a singleton.
USAGE:
Rule of thumb: `IOptionsSnapshot<T>` for per-request reload, `IOptionsMonitor<T>` for singletons and change callbacks.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/options
Is registered as Scoped and therefore can't be injected into a Singleton service.

## asp-host-09 | d2
TOPIC: 4.1 Hosting, Configuration and Options
QUALIFIER: BEST
Q:
Code review flags this logging call. What is the BEST reason to rewrite it as a message template with arguments?
```csharp
public class ShippingService(ILogger<ShippingService> logger)
{
    public void MarkShipped(int orderId, string city) =>
        logger.LogInformation($"Order {orderId} shipped to {city}");
}
```
OPT: a *
A template keeps `OrderId` and `City` as named, queryable log fields
OPT: b
String interpolation inside `LogInformation` is a compile error since .NET 6
WHY:
The call compiles and runs; analyzer rule CA2254 only flags it as a code-quality issue, it is not a compiler error.
OPT: c
Interpolated arguments are evaluated lazily, so values can change before the entry is written
WHY:
It is the reverse: the interpolated string is built eagerly at the call, even when the Information level is disabled.
OPT: d
A template skips every allocation, while interpolation allocates a string per call
WHY:
Templates still allocate an argument array and box value types like `orderId`; the saving is skipping formatting when the level is off.
A:
A message template preserves structure: the logger records `OrderId` and `City` as named properties alongside the rendered text, so a log backend can filter on them. Interpolation hands the logger one finished string, so the fields are lost.
USAGE:
In Seq, Application Insights or Elasticsearch, templates let you query "all logs where OrderId = 42" instead of text searching.
SOURCE: https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2254
When performing logging, it's desirable to preserve the structure of the log (including placeholder names) along with the placeholder values. Preserving this information allows for better observability and search in log aggregation and monitoring software.

## asp-host-10 | d2
TOPIC: 4.1 Hosting, Configuration and Options
Q:
On .NET 8, this `BackgroundService` is registered with `AddHostedService` before the app's other hosted services. `LoadAll` is synchronous and takes about 30 seconds. What is the effect on the host?
```csharp
public class CacheWarmer(IProductCache cache) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        cache.LoadAll();
        await cache.RefreshPeriodicallyAsync(ct);
    }
}
```
OPT: a
None: `ExecuteAsync` is started on a separate thread-pool thread
WHY:
`StartAsync` calls `ExecuteAsync` directly, and an async method runs synchronously on the caller's thread until its first incomplete `await`.
OPT: b
The host throws at startup because `ExecuteAsync` contains a blocking call
WHY:
The host has no such check; the code compiles and runs, and the blocking call simply holds up the caller.
OPT: c *
Startup stalls about 30 seconds; later services start only after the first incomplete `await`
OPT: d
Only the warm-up waits, because `ExecuteAsync` runs after all the other services start
WHY:
`ExecuteAsync` is invoked from the service's own `StartAsync`, in registration order, not deferred until the rest of the host has started.
A:
In .NET 8, startup stalls for the whole warm-up: the host starts hosted services one after another, and `ExecuteAsync` runs synchronously until it reaches an incomplete `await`. Fix it by awaiting `Task.Yield()` first or moving the blocking work into `Task.Run`.
USAGE:
Symptom in production: the app takes ages to start listening and readiness probes time out after a deploy.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services?view=aspnetcore-8.0
No further services are started until ExecuteAsync becomes asynchronous, such as by calling await. Avoid performing long, blocking initialization work in ExecuteAsync.

## asp-di-01 | d1
TOPIC: 4.2 Dependency Injection
Q:
A `Worker` creates its `MessageWriter` with `new` in a field initializer. Why would a reviewer ask you to take an `IMessageWriter` in the constructor instead?
A:
So `Worker` depends on an abstraction and you can swap the implementation, or pass a fake in a unit test, without editing `Worker`. The container then builds the real writer and any dependencies it has.
USAGE:
Say "the class declares what it needs; the composition root decides which implementation it gets."
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection
By using the DI pattern, the worker service doesn't use the concrete type MessageWriter, only the IMessageWriter interface that it implements. This design makes it easy to change the implementation that the worker service uses without modifying the worker service.

## asp-di-02 | d1
TOPIC: 4.2 Dependency Injection
Q:
During one HTTP request, `OrderService` and `AuditService` both inject an `IUnitOfWork` registered with `AddScoped`. Do they get the same instance, and what does the next request get?
A:
They share one instance for the whole request, and the next request gets a new one. ASP.NET Core creates a DI scope per request, and a scoped service is created once per scope and disposed when the scope ends.
USAGE:
This is why `AddDbContext` uses the scoped lifetime: one context and change tracker per request.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-usage
Scoped services change only with a new scope, but are the same instance within a scope.

## asp-di-03 | d1
TOPIC: 4.2 Dependency Injection
Q:
A controller receives an injected service that implements `IDisposable`. Should the controller call `Dispose` on it, and who cleans it up?
A:
No. The container created it, so the container disposes it when the scope that resolved it ends, or at shutdown for a singleton. Disposing it yourself can break other consumers that share the same scoped or singleton instance.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines
The container is responsible for cleanup of types it creates, and calls Dispose on IDisposable (or DisposeAsync on IAsyncDisposable) instances. Services resolved from the container should never be disposed by the developer.

## asp-di-04 | d1
TOPIC: 4.2 Dependency Injection
Q:
`Reporter`'s constructor is `Reporter(IMessageWriter one, IEnumerable<IMessageWriter> all)`. With these registrations, what do `one` and `all` receive?
```csharp
var services = new ServiceCollection();
services.AddSingleton<IMessageWriter, ConsoleWriter>();
services.AddSingleton<IMessageWriter, FileWriter>();
services.AddSingleton<Reporter>();
```
OPT: a
`one` is `ConsoleWriter`; `all` contains only `ConsoleWriter`
WHY:
A second `Add` call is not ignored; it appends another descriptor, so `FileWriter` is registered too and `all` contains both writers.
OPT: b *
`one` is `FileWriter`; `all` contains `ConsoleWriter` then `FileWriter`
OPT: c
`one` is `FileWriter`; `all` contains only `FileWriter`
WHY:
The second call does not remove the first descriptor. Both stay in the collection, so `IEnumerable<IMessageWriter>` yields both implementations.
OPT: d
Resolving `Reporter` throws because two implementations of `IMessageWriter` are registered
WHY:
Multiple registrations of one service type are allowed by design; single resolution simply takes the last one, so no exception is thrown.
A:
`one` gets `FileWriter`, the last registration, and `all` gets both implementations in registration order. Each `Add` call appends a descriptor; single resolution uses the last one, while `IEnumerable<T>` returns every one.
USAGE:
Plugin-style pipelines (validators, notifiers) rely on this: register each implementation and inject `IEnumerable<T>`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/service-registration
The ExampleService defines two constructor parameters; a single IMessageWriter, and an IEnumerable<IMessageWriter>. The single IMessageWriter is the last implementation to be registered, whereas the IEnumerable<IMessageWriter> represents all registered implementations.

## asp-di-05 | d1
TOPIC: 4.2 Dependency Injection
QUALIFIER: BEST
Q:
`Repository<T>` implements `IRepository<T>`, and the app has 30 entity types. Which registration is the BEST way to make `IRepository<Order>`, `IRepository<Customer>` and the rest resolvable?
OPT: a
One `AddScoped<IRepository<Order>, Repository<Order>>()` call per entity type, 30 in total
WHY:
It works, but every new entity needs another line, and a forgotten one fails only at runtime; a single open generic registration covers every entity.
OPT: b *
`AddScoped(typeof(IRepository<>), typeof(Repository<>))`
OPT: c
`AddScoped<IRepository<object>, Repository<object>>()`, which serves every entity type
WHY:
The container matches the exact closed service type, so a request for `IRepository<Order>` does not find an `IRepository<object>` registration.
OPT: d
`AddScoped<IRepository<>, Repository<>>()` with unbound generic type arguments
WHY:
C# does not allow an unbound generic type as a type argument, so this does not compile; open generics need the overload that takes `Type` objects.
A:
`AddScoped(typeof(IRepository<>), typeof(Repository<>))` registers the open generic once. When `IRepository<Order>` is requested, the container closes `Repository<>` over `Order` and builds it, the same way it serves `ILogger<T>`.
USAGE:
A closed registration such as `IRepository<Order>` still takes precedence, so you can override one entity's repository.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection?view=aspnetcore-8.0
The container resolves ILogger<TCategoryName> by taking advantage of (generic) open types, eliminating the need to register every (generic) constructed type.

## asp-di-06 | d2
TOPIC: 4.2 Dependency Injection
Q:
A singleton `ReportCache` takes `AppDbContext`, registered with `AddDbContext`, in its constructor. What goes wrong once the app serves many requests, and why?
A:
It captures one `AppDbContext` for the app's lifetime, so every request shares a context meant to live for one request. `AddDbContext` registers it as scoped, but a singleton is built once and keeps what it received; concurrent requests then hit a non-thread-safe context whose change tracker keeps stale entities. Fix the lifetimes: make `ReportCache` scoped, or use `IDbContextFactory<AppDbContext>` to create a short-lived context per operation.
USAGE:
Name it: "captive dependency", a longer-lived service holding a shorter-lived one.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines
The Foo object requires a Bar object, and since Foo is a singleton, and Bar is scoped, this is a misconfiguration. As is, Foo is only instantiated once, and it holds onto Bar for its lifetime, which is longer than the intended scoped lifetime of Bar.

## asp-di-07 | d2
TOPIC: 4.2 Dependency Injection
Q:
A `BackgroundService` must use a scoped `IOrderRepository` on every loop iteration. Hosted services are singletons, so how do you get the repository correctly?
A:
Inject `IServiceScopeFactory`, create a scope per iteration, and resolve the repository from `scope.ServiceProvider`. The factory is a singleton, so the hosted service can hold it safely; each scope yields a fresh repository (and its `DbContext`) and disposes them when the `using` ends, so nothing outlives one unit of work.
CODE: csharp
public sealed class OrderPump(IServiceScopeFactory scopeFactory) : BackgroundService {
    protected override async Task ExecuteAsync(CancellationToken ct) {
        while (!ct.IsCancellationRequested) {
            using var scope = scopeFactory.CreateScope();
            var repo = scope.ServiceProvider.GetRequiredService<IOrderRepository>();
            await repo.ProcessPendingAsync(ct);
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
        }
    }
}
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection
To achieve scoping services within implementations of IHostedService, such as the BackgroundService, don't inject the service dependencies via constructor injection. Instead, inject IServiceScopeFactory, create a scope, then resolve dependencies from the scope to use the appropriate service lifetime.

## asp-di-08 | d2
TOPIC: 4.2 Dependency Injection
Q:
A colleague injects `IServiceProvider` into every class and calls `GetService` inside methods "for flexibility". Why push back in code review?
A:
It hides each class's real dependencies and turns wiring mistakes into runtime failures. The constructor no longer documents what the class needs, so unit tests must build a container instead of passing fakes, and a missing registration only fails when that code path runs. It also mixes two Inversion of Control styles. Request the dependencies in the constructor instead.
USAGE:
Call it the service locator anti-pattern; the explicit dependencies principle is the counter-argument.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines
Avoid using the service locator pattern. For example, don't invoke GetService to obtain a service instance when you can use DI instead.

## asp-di-09 | d2
TOPIC: 4.2 Dependency Injection
Q:
A console job's memory grows with every iteration of this loop. `ReportWriter` implements `IDisposable`. Why?
```csharp
var services = new ServiceCollection();
services.AddTransient<ReportWriter>();
using var provider = services.BuildServiceProvider();
for (var i = 0; i < 100_000; i++)
{
    var writer = provider.GetRequiredService<ReportWriter>();
    writer.Write(i);
}
```
A:
The root provider keeps a reference to every disposable transient it creates so it can dispose it later, when the provider itself is disposed. All 100,000 writers stay rooted until then, so none can be collected. Calling `Dispose` yourself does not help, because the provider still holds the reference. Create a scope per unit of work, or create the writer through a factory and dispose it yourself.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines
When you register transient services that implement IDisposable, by default the DI container holds onto these references. It doesn't dispose of them until the container is disposed when application stops if they were resolved from the container, or until the scope is disposed if they were resolved from a scope. A memory leak can result if resolved from container level.

## asp-di-10 | d2
TOPIC: 4.2 Dependency Injection
Q:
A singleton depends on a scoped service. The app runs fine in Production but fails at startup on a developer machine with "Cannot consume scoped service ... from singleton ...". Which explanation is correct?
OPT: a *
Development enables scope validation by default, which rejects the captive dependency; Production skips the check but still has the bug
OPT: b
The developer has a newer SDK whose container forbids scoped services in singletons, while the production runtime still allows them
WHY:
The check depends on the hosting environment, not the SDK version; the same .NET 8 app throws in Production too if scope validation is turned on.
OPT: c
In Production the host creates a separate scope for each singleton, so the scoped dependency is handled safely there
WHY:
No such scope exists; in Production the singleton silently captures one scoped instance for the app's lifetime, which is exactly the bug the check reports.
OPT: d
The Visual Studio debugger tracks service lifetimes and raises the exception only while a debugger is attached
WHY:
The exception comes from the service provider's own scope validation, which the host turns on for the Development environment with or without a debugger.
A:
Scope validation is on by default only in Development, so the captive dependency throws there. Production skips the check, so the singleton silently keeps one scoped instance; the fix is the lifetimes, not the environment.
USAGE:
Don't "fix" it by disabling `ValidateScopes`; run integration tests in Development so the check fires in CI.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/service-lifetimes
By default, in the development environment, resolving a service from another service with a longer lifetime throws an exception.

## asp-di-11 | d2
TOPIC: 4.2 Dependency Injection
QUALIFIER: BEST
Q:
Your library's `AddMyLibrary()` must register a default `IRetryPolicy` without replacing one the app registered earlier. Which registration is the BEST fit?
OPT: a
`services.AddSingleton<IRetryPolicy, DefaultRetryPolicy>()`
WHY:
`Add` registers the library default unconditionally, so it overrides the app's own policy instead of yielding to it.
OPT: b *
`services.TryAddSingleton<IRetryPolicy, DefaultRetryPolicy>()`
OPT: c
`services.Replace(ServiceDescriptor.Singleton<IRetryPolicy, DefaultRetryPolicy>())`
WHY:
`Replace` removes the app's existing registration and puts the library default in its place, the opposite of what is required.
OPT: d
`services.TryAddEnumerable(ServiceDescriptor.Singleton<IRetryPolicy, DefaultRetryPolicy>())`
WHY:
`TryAddEnumerable` skips only when the same implementation type is already registered, so an app policy of another type does not stop the library default from being added.
A:
`TryAddSingleton` adds the default only when no `IRetryPolicy` is registered yet. If the app already registered its own policy, the call does nothing, so the library never displaces the app's choice.
USAGE:
Framework `Add{Feature}` methods use `TryAdd` internally so apps can override their defaults.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/service-registration
The framework also provides TryAdd{LIFETIME} extension methods, which register the service only if there isn't already an implementation registered.

## asp-di-12 | d2
TOPIC: 4.2 Dependency Injection
QUALIFIER: BEST
Q:
In .NET 8, `BigCache` and `SmallCache` both implement `ICache`. One consumer class must receive `BigCache` through its constructor, while other classes keep getting `SmallCache`. Which approach is BEST?
OPT: a *
Register `BigCache` with `AddKeyedSingleton<ICache, BigCache>("big")` and mark the parameter `[FromKeyedServices("big")]`
OPT: b
Inject `IEnumerable<ICache>` and pick the instance with `OfType<BigCache>().First()`
WHY:
The consumer becomes coupled to the concrete class it should not know, and every `ICache` implementation is constructed just to pick one.
OPT: c
Inject `IServiceProvider` and call `GetRequiredService<BigCache>()` inside the constructor
WHY:
This is the service locator pattern: the dependency is hidden from the signature, and `BigCache` must also be registered as its own concrete service type.
OPT: d
Register `BigCache` after `SmallCache` so the consumer's `ICache` parameter resolves to it
WHY:
The last registration wins for every consumer, so the other classes would also receive `BigCache` instead of `SmallCache`.
A:
Keyed services, new in .NET 8: register `BigCache` under a key and put `[FromKeyedServices("big")]` on the constructor parameter. The dependency stays the `ICache` abstraction and the choice is explicit in the signature, with no service locator or marker interface.
USAGE:
Typical uses: two caches, two storage accounts, or per-tenant clients that share one interface.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-8/runtime
The FromKeyedServicesAttribute attribute, which can be used on service constructor parameters to specify which keyed service to use.

## asp-mw-01 | d1
TOPIC: 4.3 Middleware Pipeline
Q:
One request reaches this app. In what order are the four console lines printed?
```csharp
var app = WebApplication.CreateBuilder(args).Build();
app.Use(async (context, next) =>
{ Console.WriteLine("A before"); await next(context); Console.WriteLine("A after"); });
app.Use(async (context, next) =>
{ Console.WriteLine("B before"); await next(context); Console.WriteLine("B after"); });
app.Run(context => context.Response.WriteAsync("Hello"));
app.Run();
```
A:
`A before`, `B before`, `B after`, `A after`. Middleware runs in registration order on the way in, and the code after each `await next(context)` runs as the calls unwind, so the response path is the reverse order.
USAGE:
This is why exception handling and logging middleware go first: they wrap everything registered after them.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/?view=aspnetcore-8.0
The order that middleware appears in the app's Program file defines the order in which middleware are invoked on a request with the reverse order for the response.

## asp-mw-02 | d1
TOPIC: 4.3 Middleware Pipeline
Q:
A developer adds a logging `app.Use(...)` middleware below an `app.Run(async context => ...)` delegate in Program.cs, and its log line never appears. Why, and how do `Use` and `Run` differ?
A:
The `Run` delegate is terminal, so nothing registered after it is ever reached. `Run` receives no `next` parameter and cannot pass the request on, while `Use` receives `next` and decides whether to call it. Move the logger above `Run`.
USAGE:
Use `Run` only for the final handler; anything that must observe every request belongs before it.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/?view=aspnetcore-8.0
A Run delegate doesn't receive a next parameter. The first Run delegate always terminates the pipeline.

## asp-mw-03 | d1
TOPIC: 4.3 Middleware Pipeline
Q:
You move an inline `app.Use` lambda into a reusable convention-based middleware class (one that does not implement `IMiddleware`) and register it with `app.UseMiddleware<T>()`. What must that class expose for ASP.NET Core to call it?
A:
A public constructor that takes a `RequestDelegate` (the next middleware) and a public `Invoke` or `InvokeAsync` method that returns `Task` and takes `HttpContext` first. The convention is checked by reflection, not by an interface, so a wrong signature fails when the pipeline is built at startup, not at compile time.
USAGE:
Wrap the registration in an extension method such as `app.UseRequestCulture()`, the way built-in middleware is exposed.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/write?view=aspnetcore-8.0
The middleware class must include: A public constructor with a parameter of type RequestDelegate. A public method named Invoke or InvokeAsync.

## asp-mw-04 | d2
TOPIC: 4.3 Middleware Pipeline
Q:
You want extra logging only for requests that carry a `?debug` query key, and those requests must still reach the normal endpoints. Why choose `UseWhen` rather than `MapWhen`?
A:
Because a `UseWhen` branch rejoins the main pipeline, while a `MapWhen` branch never does. `MapWhen` forks the pipeline: matching requests run only the branch's middleware, so without a terminal handler there they never reach routing or endpoints and end as 404. `UseWhen` runs the branch's middleware and then continues into the rest of the main pipeline, unless the branch itself short-circuits.
USAGE:
Rule of thumb: `MapWhen` hands requests to a separate mini-app; `UseWhen` adds conditional middleware.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/?view=aspnetcore-8.0
UseWhen can branch the request pipeline based on the result of the given predicate. Unlike MapWhen, the branch is rejoined to the main pipeline if it doesn't contain a terminal middleware:

## asp-mw-05 | d2
TOPIC: 4.3 Middleware Pipeline
Q:
This middleware throws `InvalidOperationException` for endpoints that return a body, but not for ones that return 204. Why, and how do you fix it?
```csharp
var app = WebApplication.CreateBuilder(args).Build();
app.Use(async (context, next) =>
{
    await next(context);
    context.Response.Headers["X-Server-Time"] = DateTime.UtcNow.ToString("O");
});
```
A:
Once an endpoint writes the body, the headers have already been sent, so they are read-only. Writing the body starts the response and flushes the status line and headers to the client; a 204 writes nothing, so its headers are still editable. Register `context.Response.OnStarting(...)` before calling `next` to set the header just in time, or check `context.Response.HasStarted` and skip it.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices?view=aspnetcore-8.0
In the preceding code, context.Response.Headers["test"] = "test value"; will throw an exception if next() has written to the response.

## asp-mw-06 | d2
TOPIC: 4.3 Middleware Pipeline
Q:
An API uses exception handling, HTTPS redirection, static files, routing, CORS, JWT authentication and authorization. Which Program.cs order is correct?
OPT: a *
`UseExceptionHandler` → `UseHttpsRedirection` → `UseStaticFiles` → `UseRouting` → `UseCors` → `UseAuthentication` → `UseAuthorization` → `MapControllers`
OPT: b
`UseExceptionHandler` → `UseHttpsRedirection` → `UseStaticFiles` → `UseRouting` → `UseAuthentication` → `UseAuthorization` → `UseCors` → `MapControllers`
WHY:
Authorization runs before CORS, so a cross-origin preflight or a 401 leaves without CORS headers and the browser blocks the call; CORS must precede authentication and authorization.
OPT: c
`UseExceptionHandler` → `UseHttpsRedirection` → `UseStaticFiles` → `UseRouting` → `UseCors` → `UseAuthorization` → `UseAuthentication` → `MapControllers`
WHY:
Authorization runs before authentication has set `HttpContext.User`, so it sees an anonymous user and rejects protected endpoints even when the token is valid.
OPT: d
`UseHttpsRedirection` → `UseStaticFiles` → `UseRouting` → `UseCors` → `UseAuthentication` → `UseAuthorization` → `UseExceptionHandler` → `MapControllers`
WHY:
The exception handler only catches exceptions thrown by middleware registered after it, so failures in routing, CORS or authentication escape it.
A:
`UseExceptionHandler` first, then HTTPS redirection, static files and `UseRouting`, then `UseCors` → `UseAuthentication` → `UseAuthorization`, then the endpoints. The handler must wrap everything after it, CORS must add its headers before auth can reject a request, and authorization needs the user that authentication sets.
USAGE:
"Order doesn't matter" is a red flag in interviews; the CORS → authentication → authorization order is documented as required.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/middleware/?view=aspnetcore-8.0
CORS middleware (UseCors), authentication middleware (UseAuthentication), and authorization middleware (UseAuthorization) must appear in the order shown.

## asp-mw-07 | d2
TOPIC: 4.3 Middleware Pipeline
Q:
In .NET 8 an API calls `AddExceptionHandler<NotFoundHandler>()`, `AddProblemDetails()` and `app.UseExceptionHandler()`. For a `TimeoutException`, `TryHandleAsync` returns `false`. What does a JSON client in Production receive?
OPT: a *
A 500 response with a problem details JSON body written by the middleware's fallback
OPT: b
A 500 response with an empty body, because no handler claimed the exception
WHY:
Returning `false` hands the exception back to the middleware's fallback; with `AddProblemDetails()` registered, that fallback writes a problem details body rather than an empty one.
OPT: c
The developer exception page, because no registered `IExceptionHandler` handled the exception
WHY:
The developer exception page is added only in the Development environment; in Production the exception handler middleware applies its own fallback.
OPT: d
A 404 Not Found, because the declining handler left the response without a status code or body
WHY:
The 404 outcome belongs to a handler that returns `true` without writing a response; `false` makes the middleware produce the response itself.
A:
A 500 problem details response. The middleware asks each registered `IExceptionHandler` in order; when every `TryHandleAsync` returns `false`, it falls back to its configured behavior, which `AddProblemDetails()` makes a problem details JSON body.
USAGE:
Return `false` for exceptions a handler does not own, so the app-wide fallback still answers consistently.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling?view=aspnetcore-8.0
The IExceptionHandler implementations still run first in all of these cases. The configured path, problem details response, or fallback handler is used only when every TryHandleAsync returns false.

## asp-mw-08 | d2
TOPIC: 4.3 Middleware Pipeline
QUALIFIER: BEST
Q:
You need cross-cutting logic that reads the selected controller action's bound arguments, for API controllers only. Which is the BEST fit?
OPT: a *
An action filter that reads `ActionExecutingContext.ActionArguments`
OPT: b
Custom middleware registered before `UseRouting`
WHY:
Before routing no endpoint is selected and nothing is bound, so the middleware sees only the raw `HttpContext`.
OPT: c
Middleware branched with `MapWhen` on the `/api` path prefix
WHY:
The branch limits which requests run it, but middleware still runs outside MVC, and model binding has not happened, so there are no bound arguments.
OPT: d
Inline `app.Use` middleware registered after `UseAuthorization`, reading the selected endpoint
WHY:
After routing it can see which endpoint was selected, but model binding runs later inside the action invocation, so the arguments do not exist yet.
A:
An action filter. Filters run inside MVC's action invocation pipeline, after the action is selected and its arguments are bound, so `OnActionExecuting` can read `ActionArguments`; applying it to API controllers scopes it. Middleware runs for every request and sees only `HttpContext`.
USAGE:
Middleware for HTTP-level concerns (logging, CORS, compression); filters when you need MVC context such as action, arguments or result.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/filters?view=aspnetcore-8.0
Filters run within the ASP.NET Core action invocation pipeline, sometimes referred to as the filter pipeline. The filter pipeline runs after ASP.NET Core selects the action to execute:

## asp-api-01 | d1
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
You are starting a new HTTP API on ASP.NET Core 8 with no special framework needs. Would you default to Minimal APIs or controllers, and why?
A:
Minimal APIs, because Microsoft recommends them for new projects: they are a simplified, high-performance way to build APIs with less code and configuration. Controllers remain a fully supported choice when a project needs their built-in extensibility.
USAGE:
Say "Minimal APIs by default, controllers when I need a specific MVC feature" rather than treating either as legacy.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/apis?view=aspnetcore-8.0
ASP.NET Core provides two approaches for building HTTP APIs: Minimal APIs and controller-based APIs. For new projects, we recommend using Minimal APIs as they provide a simplified, high-performance approach for building APIs with minimal code and configuration.

## asp-api-02 | d1
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
An endpoint is mapped as `app.MapGet("/users/{userId}/books/{bookId}", (int userId, int bookId) => ...)` with no attributes. For `GET /users/7/books/3`, where do `userId` and `bookId` get their values?
A:
From the route: `userId` is 7 and `bookId` is 3. Minimal APIs bind a parameter from the route whenever its name matches a segment in the route template, so no `[FromRoute]` attribute is needed.
USAGE:
Renaming a parameter so it no longer matches the template silently moves it to the query string; keep the names in sync.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding?view=aspnetcore-8.0
If the parameter name exists in the route template for example, app.Map("/todo/{id}", (int id) => {});, then it's bound from the route.

## asp-api-03 | d1
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
Five Minimal API endpoints all start with `/admin/todos` and all need `RequireAuthorization()`. How do you avoid repeating the prefix and the authorization call on each one?
A:
Create a route group with `app.MapGroup("/admin/todos").RequireAuthorization()` and map the five endpoints on that group. Every endpoint in the group inherits the prefix and the metadata added to the group with a single call.
USAGE:
Groups keep a feature's endpoints together, e.g. one extension method per feature that returns the configured `RouteGroupBuilder`.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers?view=aspnetcore-8.0
The MapGroup extension method helps organize groups of endpoints with a common prefix and reduces repetitive code. Use this method to customize entire groups of endpoints with a single call to methods like RequireAuthorization and WithMetadata that add endpoint metadata.

## asp-api-04 | d1
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
In an `[ApiController]` controller, a reviewer asks you to delete the `if (!ModelState.IsValid) return BadRequest(ModelState);` check at the top of every action. Why is that safe, and what does the client get instead?
A:
It is safe because `[ApiController]` already short-circuits invalid model state with an automatic HTTP 400 before the action runs. The default body is a `ValidationProblemDetails` object listing the errors per field.
USAGE:
Mention that the automatic response only exists with `[ApiController]`; a plain MVC controller still has to check `ModelState` itself.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/web-api/?view=aspnetcore-8.0
The [ApiController] attribute makes model validation errors automatically trigger an HTTP 400 response. Consequently, the following code is unnecessary in an action method:

## asp-api-05 | d1
TOPIC: 4.4 Minimal APIs, Controllers, Filters
QUALIFIER: BEST
Q:
A POST action has just saved a new product, and the client must learn the URL of the new resource. Which return statement is the BEST fit?
OPT: a
`return Ok(new { product, url = $"/api/products/{product.Id}" });`
WHY:
This sends 200 with an ad hoc URL field in the body; there is no 201 status and no Location header, so standard HTTP clients see nothing created.
OPT: b *
`return CreatedAtAction(nameof(GetById), new { id = product.Id }, product);`
OPT: c
`return StatusCode(201, product);`
WHY:
The status is 201, but nothing builds a Location header, so the client still cannot discover the new resource's URL.
OPT: d
`return AcceptedAtAction(nameof(GetById), new { id = product.Id }, product);`
WHY:
202 Accepted means the request was queued and is not finished yet, which misstates a product that has already been saved.
A:
`CreatedAtAction(nameof(GetById), new { id = product.Id }, product)` returns 201 Created, puts the product in the body, and builds a Location header pointing at the `GetById` action for that id.
USAGE:
Pair it with `nameof` so renaming the GET action cannot silently break the generated Location URL.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/web-api/action-return-types?view=aspnetcore-8.0
A 201 status code is generated by the CreatedAtAction method when a product is created. In this code path, the Product object is provided in the response body. A Location response header containing the newly created product's URL is provided.

## asp-api-06 | d1
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
The only route in the app is `/orders/{id:int}`. A client calls `GET /orders/abc`. Which response does the client get?
OPT: a
400 Bad Request with a validation error saying id must be an integer
WHY:
No binding or validation happens: the constraint makes the route fail to match, so no endpoint is selected to produce a 400.
OPT: b *
404 Not Found
OPT: c
500 Internal Server Error from a failed int conversion
WHY:
The text is never converted; the `int` constraint just rejects the URL during matching, so nothing throws.
OPT: d
200 from the handler, which runs with id = 0
WHY:
The handler is never reached, because routing only selects an endpoint whose constraints all accept the URL.
A:
404 Not Found. A route constraint takes part in URL matching, so `abc` makes `/orders/{id:int}` not match and no endpoint is found. That is why constraints should disambiguate routes, not validate input.
USAGE:
A client sending a malformed id gets 404 and assumes the order does not exist; validate in the handler to return a helpful 400.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing?view=aspnetcore-8.0
Don't use constraints for input validation. If constraints are used for input validation, invalid input results in a 404 Not Found response. Invalid input should produce a 400 Bad Request with an appropriate error message.

## asp-api-07 | d2
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
An `[ApiController]` action is declared `Post(Product product, Order order)` with no binding attributes. What happens, and how do you redesign it?
A:
The framework throws an exception instead of binding, because both complex parameters are inferred as `[FromBody]` and only one parameter can bind from the body. The request body is a single stream read once by one input formatter, so it cannot be split across two parameters. Redesign with one request DTO that contains both the product and the order, or move one value to the route or query.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/web-api/?view=aspnetcore-8.0
When an action has more than one parameter bound from the request body, an exception is thrown. For example, all of the following action method signatures cause an exception:

## asp-api-08 | d2
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
Why does this Minimal API handler not compile, and what return type fixes it?
```csharp
var app = WebApplication.Create();
var flag = (bool on) => on ? TypedResults.Ok("on") : TypedResults.NotFound();
app.MapGet("/flags/{on}", flag);
app.Run();
```
A:
The lambda's return type cannot be inferred: `TypedResults.Ok` returns `Ok<string>`, `TypedResults.NotFound` returns `NotFound`, and the compiler will not pick a common type for the conditional. Declare the lambda's return type as `Results<Ok<string>, NotFound>`; both results convert implicitly to it, and the declared types become OpenAPI metadata. `Results.Ok`/`Results.NotFound` compile because both return `IResult`, but lose that metadata.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses?view=aspnetcore-8.0
The following method does not compile, because TypedResults.Ok and TypedResults.NotFound are declared as returning different types and the compiler won't attempt to infer the best matching type:

## asp-api-09 | d2
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
A global, a controller-level and an action-level action filter each log in `OnActionExecuting` and `OnActionExecuted`. In what order do the six log lines appear, and why?
A:
Global, controller, action executing; then action, controller, global executed. Filters of the same stage nest by scope, with global outermost, so each filter's after code runs as the inner layers unwind. Consequently a global filter sees the final result of everything inside it; use `Order` to change this default.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/filters?view=aspnetcore-8.0
When there are multiple filters for a particular stage of the pipeline, scope determines the default order of filter execution. Global filters surround class filters, which in turn surround method filters.

## asp-api-10 | d2
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
The project has `<Nullable>enable</Nullable>`. The client posts the JSON body `{}` to `Create`. What does the client get?
```csharp
using Microsoft.AspNetCore.Mvc;
[ApiController, Route("people")]
public class PeopleController : ControllerBase
{
    [HttpPost] public IActionResult Create(Person p) => Ok(p);
}
public class Person
{
    public string Name { get; set; }
}
```
OPT: a *
400 with a validation error for `Name`
OPT: b
200 with `"name": null` in the body
WHY:
Nullable annotations are not only compile-time warnings here: MVC treats a non-nullable `string` property as implicitly required, so a missing `Name` fails validation.
OPT: c
200 with `Name` set to an empty string
WHY:
The deserializer leaves a missing property null and never substitutes an empty string, and the implicit required check rejects that null.
OPT: d
500 from a `NullReferenceException` in the action
WHY:
The action body never runs: `[ApiController]` returns the automatic 400 before the action, and `Ok(p)` would not dereference `Name` anyway.
A:
A 400 with a validation error for `Name`. With nullable reference types enabled, MVC treats a non-nullable property as if it had `[Required]`, so the missing value invalidates model state and `[ApiController]` answers before the action runs. Declare `string?` to allow it.
USAGE:
Turning on nullable in an existing API can start rejecting requests that omitted optional strings; mark those properties `string?` first.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/mvc/models/validation?view=aspnetcore-8.0
If the app was built with <Nullable>enable</Nullable>, a missing value for Name in a JSON or form post results in a validation error.

## asp-api-11 | d2
TOPIC: 4.4 Minimal APIs, Controllers, Filters
QUALIFIER: BEST
Q:
A controller action returns either `NotFound()` or a `Product`. You want to write `return product;` and have the 200 response type inferred for `[ProducesResponseType]`. Which declared return type is BEST?
OPT: a
`IActionResult`
WHY:
`return product;` does not compile against `IActionResult`, so you must write `Ok(product)` and state the response type on `[ProducesResponseType]` yourself.
OPT: b *
`ActionResult<Product>`
OPT: c
`ActionResult<object>`
WHY:
Here `T` is `object`, so the inferred 200 response type is `object` rather than `Product`, and the API description loses the product schema.
OPT: d
`Results<Ok<Product>, NotFound>`
WHY:
`return product;` does not compile: `Results<,>` converts only from `Ok<Product>` or `NotFound`, and the controller's `NotFound()` returns `NotFoundResult`, not `NotFound`.
A:
`ActionResult<Product>`. Implicit conversions from both `Product` and `ActionResult` let the action write `return product;` or `return NotFound();`, and the `T` gives `[ProducesResponseType]` the 200 response type without a `Type` argument.
USAGE:
In controllers say "ActionResult<T> when there is one success type"; reserve `IActionResult` for actions whose success bodies vary.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/web-api/action-return-types?view=aspnetcore-8.0
Implicit cast operators support the conversion of both T and ActionResult to ActionResult<T>. T converts to ObjectResult, which means return new ObjectResult(T); is simplified to return T;.

## asp-api-12 | d2
TOPIC: 4.4 Minimal APIs, Controllers, Filters
Q:
What do the filters write to the console for one request to `/`?
```csharp
var app = WebApplication.Create();
app.MapGet("/", () => "ok")
    .AddEndpointFilter(async (ctx, next) =>
        { Console.Write("A1 "); var r = await next(ctx); Console.Write("A2 "); return r; })
    .AddEndpointFilter(async (ctx, next) =>
        { Console.Write("B1 "); var r = await next(ctx); Console.Write("B2 "); return r; });
app.Run();
```
OPT: a *
`A1 B1 B2 A2 `
OPT: b
`A1 B1 A2 B2 `
WHY:
This treats the after code as first in, first out; filters nest, so the inner filter B must finish before A resumes.
OPT: c
`B1 A1 A2 B2 `
WHY:
This assumes the last filter added is outermost; endpoint filters run their before code in the order they were added.
OPT: d
`B1 A1 B2 A2 `
WHY:
The after code here is correct (FILO), but the before code is reversed; before code runs in add order (FIFO), so A1 must come before B1.
A:
`A1 B1 B2 A2 `. Each endpoint filter wraps the next one: the before code runs in add order (FIFO), and the after code runs in reverse (FILO) as the chain unwinds from the handler back to A.
USAGE:
Add the filter that must see the final result, such as timing or logging, first so it wraps all the others.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters?view=aspnetcore-8.0
The execution order of filter code called before the call to EndpointFilterDelegate (next) is First In, First Out (FIFO). The execution order of filter code called after the call to EndpointFilterDelegate (next) is First In, Last Out (FILO).

## asp-auth-01 | d1
TOPIC: 4.5 Auth and CORS
Q:
A signed-in user with a valid JWT calls an admin-only endpoint and gets 403, not 401. Which step failed, authentication or authorization, and why does the status code differ?
A:
Authorization failed: authentication succeeded, so the user's identity is known, but the policy denied them. A 401 (challenge) means "we don't know who you are"; a 403 (forbid) means "we know who you are, and you aren't allowed", so retrying with a fresh token won't help.
USAGE:
In interviews, map 401 to "who are you?" and 403 to "you can't do that"; clients should re-authenticate on 401 only.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/?view=aspnetcore-8.0
An authentication scheme's forbid action is called by Authorization when an authenticated user attempts to access a resource they're not permitted to access.

## asp-auth-02 | d2
TOPIC: 4.5 Auth and CORS
Q:
A request with a valid JWT for `/orders` still gets 401. Why?
```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAuthentication("Bearer").AddJwtBearer();
builder.Services.AddAuthorization();
var app = builder.Build();
app.UseAuthorization();
app.UseAuthentication();
app.MapGet("/orders", () => "ok").RequireAuthorization();
app.Run();
```
A:
`UseAuthorization` runs before `UseAuthentication`, so the token hasn't been read yet when the policy is evaluated. Middleware runs in registration order: the authorization middleware sees an anonymous `HttpContext.User`, the default policy requires an authenticated user, so it challenges and returns 401 before authentication ever runs. Swapping the two calls fixes it.
USAGE:
A classic "works in Postman with the right token, still 401" bug; check pipeline order before blaming the token.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/?view=aspnetcore-8.0
Call UseAuthentication before any middleware that depends on users being authenticated.

## asp-auth-03 | d2
TOPIC: 4.5 Auth and CORS
Q:
Your API accepts an access token that your identity provider issued for a different API. Signature and issuer checks pass. Which validation is missing, and what should the API return when it fails?
A:
Audience validation is missing: the API must check that the token's `aud` claim matches its own identifier, and return 401 when it doesn't. A valid signature and issuer only prove the token came untampered from a trusted provider; `aud` says which API it was minted for. Without that check (for example `ValidateAudience = false`), any token for any sibling API can be replayed against yours.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication?view=aspnetcore-8.0
Incorrect claims: Critical claims within the token, such as the audience (aud) or issuer (iss), are missing or invalid.

## asp-auth-04 | d2
TOPIC: 4.5 Auth and CORS
Q:
A teammate says restricting the CORS policy to the SPA's origin stops scripts and other servers from calling the API. Why is that wrong, and what actually protects the API?
A:
CORS is enforced by the browser, not the server, so it doesn't stop non-browser callers; authentication and authorization protect the API. The server still executes the request and returns the response; only the browser checks the CORS headers and hides the response from page script. curl, Postman or another backend ignore CORS entirely, so every endpoint still needs its own access checks.
USAGE:
CORS relaxes the same-origin policy; it's never a substitute for `[Authorize]` or a fallback policy.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/security/cors?view=aspnetcore-8.0
It's up to the client (browser) to enforce CORS. The server executes the request and returns the response, it's the client that returns an error and blocks the response.

## asp-auth-05 | d2
TOPIC: 4.5 Auth and CORS
QUALIFIER: BEST
Q:
A policy must admit users who have either a `BadgeId` claim or a `TemporaryBadgeId` claim. Which design is the BEST fit?
OPT: a
One policy with a `BadgeId` requirement and a `TemporaryBadgeId` requirement, each with its own handler
WHY:
All requirements in one policy must pass, so a user needs both claims; this builds AND, not OR.
OPT: b
Two `[Authorize(Policy = ...)]` attributes on the endpoint, one policy per claim
WHY:
Multiple authorize attributes are combined, so the user must satisfy both policies; it is still AND.
OPT: c *
One requirement with two handlers, each checking one of the two claims
OPT: d
One requirement with two handlers, where the `BadgeId` handler calls `context.Fail()` when its claim is missing
WHY:
`context.Fail()` forces the requirement to fail even if the `TemporaryBadgeId` handler succeeds, so users with only a temporary badge are denied.
A:
One requirement with two handlers gives OR semantics: the requirement is met when any handler calls `context.Succeed`, and a handler that simply doesn't succeed doesn't block the others. Separate requirements or policies are ANDed.
USAGE:
Say "requirements AND, handlers OR"; reach for `context.Fail()` only when one handler must veto, such as a suspended account.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies?view=aspnetcore-8.0
In cases where you want evaluation to be on an OR basis, implement multiple handlers for a single requirement.

## ef-query-01 | d1
TOPIC: 5.1 EF Core Querying and Tracking
Q:
A GET endpoint only lists products and never saves changes to them. Why would you add AsNoTracking() to its EF Core query?
A:
Because nothing is saved, change tracking is pure overhead, and AsNoTracking() skips it, so the query is generally faster and allocates less. Tracking only pays off when you modify the loaded entities and call SaveChanges, which this endpoint never does.
USAGE:
Say "tracking is for entities you intend to update"; read-only endpoints and reports are the classic no-tracking case.
SOURCE: https://learn.microsoft.com/en-us/ef/core/querying/tracking
No-tracking queries are useful when the results are used in a read-only scenario. They're generally quicker to execute because there's no need to set up the change tracking information.

## ef-query-02 | d1
TOPIC: 5.1 EF Core Querying and Tracking
Q:
You load blogs with ToListAsync() and then read blog.Posts, but the collection is empty. Why, and how do you load each blog's posts, and each post's comments, in the same query?
A:
EF Core loads only the entity you queried, not its navigations, so Posts stays empty; add Include(b => b.Posts).ThenInclude(p => p.Comments) to the query. Include joins the related rows into the same SQL query, and ThenInclude goes one level deeper from the included navigation.
SOURCE: https://learn.microsoft.com/en-us/ef/core/querying/related-data/eager
You can use the Include method to specify related data to be included in query results. In the following example, the blogs that are returned in the results will have their Posts property populated with the related posts.

## ef-query-03 | d1
TOPIC: 5.1 EF Core Querying and Tracking
Q:
In an ASP.NET Core action, why call ToListAsync() and SaveChangesAsync() rather than ToList() and SaveChanges()?
A:
The async versions release the request thread while the database does its work, so that thread can serve other requests and throughput rises under load. A synchronous call holds a thread-pool thread idle for the whole roundtrip, and many such calls can starve the pool.
USAGE:
Pair it with "async all the way": calling .Result on ToListAsync() brings the blocking back.
SOURCE: https://learn.microsoft.com/en-us/ef/core/miscellaneous/async
Asynchronous operations avoid blocking a thread while the query is executed in the database. Async operations are important for keeping a responsive UI in rich client applications, and can also increase throughput in web applications where they free up the thread to service other requests in web applications.

## ef-query-04 | d1
TOPIC: 5.1 EF Core Querying and Tracking
QUALIFIER: BEST
Q:
An app is going to production, and its EF Core model will keep gaining new columns. How should the team BEST manage the database schema?
OPT: a
Call Database.EnsureCreatedAsync() at startup so the schema matches the model
WHY:
EnsureCreated only creates a database that does not exist yet; it does not alter an existing schema, so new columns are not added.
OPT: b
Call EnsureDeletedAsync() and then EnsureCreatedAsync() on every deployment
WHY:
EnsureDeleted drops the whole database, so every deployment would wipe the production data.
OPT: c *
Add a migration for each model change and apply the migrations to the database
OPT: d
Alter the production tables by hand to match the updated entity classes
WHY:
Manual changes are not versioned or repeatable across environments, and EF Core has no record of them, so the model and database drift apart.
A:
Add a migration for each model change: migrations update the schema incrementally and keep existing data, while EnsureCreated only builds a fresh database and cannot evolve one.
USAGE:
EnsureCreated is fine for demos and throwaway test databases; mention that a database created by it cannot later be updated with migrations.
SOURCE: https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/
The migrations feature in EF Core provides a way to incrementally update the database schema to keep it in sync with the application's data model while preserving existing data in the database.

## ef-query-05 | d2
TOPIC: 5.1 EF Core Querying and Tracking
Q:
AppDbContext uses SQL Server and is registered with AddDbContext. What happens when GetCountsAsync runs, and how do you fix it?
```csharp
public class DashboardService(AppDbContext db)
{
    public async Task<(int, int)> GetCountsAsync()
    {
        var orders = db.Orders.CountAsync();
        var customers = db.Customers.CountAsync();
        await Task.WhenAll(orders, customers);
        return (await orders, await customers);
    }
}
```
A:
It is unsupported and usually throws InvalidOperationException ("A second operation was started on this context instance..."), because the second query starts while the first is still running. A DbContext is not thread-safe, and EF Core's detection is best effort. Fix it by awaiting each query before starting the next, or, if you really need parallelism, give each query its own context from IDbContextFactory<AppDbContext>.
SOURCE: https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/
Entity Framework Core does not support multiple parallel operations being run on the same DbContext instance. This includes both parallel execution of async queries and any explicit concurrent use from multiple threads. Therefore, always await async calls immediately, or use separate DbContext instances for operations that execute in parallel.

## ef-query-06 | d2
TOPIC: 5.1 EF Core Querying and Tracking
Q:
Lazy-loading proxies are enabled and the table holds 100 blogs. How many database roundtrips does Print make, and what would you change?
```csharp
public class BlogReport(AppDbContext db)
{
    public void Print()
    {
        foreach (var blog in db.Blogs.ToList())
            foreach (var post in blog.Posts)
                Console.WriteLine($"{blog.Url}: {post.Title}");
    }
}
```
A:
101: one query for the blogs, then one more for each blog when its Posts property is first read. Lazy loading fetches a navigation on access, so the inner loop triggers a roundtrip per blog (the N+1 problem). Load the posts up front instead, with Include(b => b.Posts) or a projection such as Select(b => new { b.Url, Titles = b.Posts.Select(p => p.Title) }).
USAGE:
N+1 rarely shows up with 10 rows in development; it appears in production logs as hundreds of identical queries per request.
SOURCE: https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying
With lazy loading, a Blog's Posts are only (lazily) loaded when its Posts property is accessed; as a result, each iteration in the inner foreach triggers an additional database query, in its own roundtrip. As a result, after the initial query loading all the blogs, we then have another query per blog, loading all its posts; this is sometimes called the N+1 problem, and it can cause very significant performance issues.

## ef-query-07 | d2
TOPIC: 5.1 EF Core Querying and Tracking
Q:
A query calls Include(b => b.Posts).Include(b => b.Contributors). For a blog with 10 posts and 10 contributors the database returns 100 rows. Why, and which operator avoids it?
A:
Posts and Contributors are sibling collections, so the single SQL query joins both to Blogs and returns their cross product, 10 × 10 rows per blog. AsSplitQuery() makes EF Core load blogs, posts and contributors in separate queries, so the rows add up (10 + 10) instead of multiplying. The price is extra roundtrips, so use it when sibling collections are large.
USAGE:
Call it "cartesian explosion"; it gets worse with every extra sibling Include.
SOURCE: https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries
In this example, since both Posts and Contributors are collection navigations of Blog - they're at the same level - relational databases return a cross product: each row from Posts is joined with each row from Contributors. This means that if a given blog has 10 posts and 10 contributors, the database returns 100 rows for that single blog.

## ef-query-08 | d2
TOPIC: 5.1 EF Core Querying and Tracking
Q:
A colleague runs db.Blogs.FromSqlRaw("EXECUTE dbo.GetBlogs '" + user + "'"). You suggest db.Blogs.FromSql($"EXECUTE dbo.GetBlogs {user}"). Why is your version safe from SQL injection when it looks like ordinary string interpolation?
A:
FromSql takes a FormattableString, so EF Core sends each interpolated value as a DbParameter instead of pasting it into the SQL text. With concatenation, input like x'; DROP TABLE Blogs;-- becomes part of the command and executes; a parameter is only treated as data. Passing the same interpolated string to FromSqlRaw loses this protection, because it is converted to a plain string first.
SOURCE: https://learn.microsoft.com/en-us/ef/core/querying/sql-queries
While this syntax may look like regular C# string interpolation, the supplied value is wrapped in a DbParameter and the generated parameter name inserted where the {0} placeholder was specified. This makes FromSql safe from SQL injection attacks, and sends the value efficiently and correctly to the database.

## ef-query-09 | d2
TOPIC: 5.1 EF Core Querying and Tracking
Q:
SomeBlog has Rating 5 before RunAsync executes. What rating is stored in the database afterwards, and why?
```csharp
public class RatingJob(AppDbContext db)
{
    public async Task RunAsync()
    {
        var blog = await db.Blogs.SingleAsync(b => b.Name == "SomeBlog");
        await db.Blogs.ExecuteUpdateAsync(s => s.SetProperty(b => b.Rating, b => b.Rating + 1));
        blog.Rating += 2;
        await db.SaveChangesAsync();
    }
}
```
A:
7. ExecuteUpdateAsync runs immediately in the database (5 becomes 6) but bypasses the change tracker, so the tracked blog still holds 5. Adding 2 makes it 7, and SaveChangesAsync sees a change from the original 5 and writes 7, overwriting the bulk update. Avoid mixing tracked edits and ExecuteUpdate/ExecuteDelete on the same rows, or reload the entity after the bulk operation.
SOURCE: https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete
Crucially, when ExecuteUpdate is invoked and all Blogs are updated in the database, EF's change tracker is not updated, and the tracked .NET instance still has its original rating value, from the point at which it was queried.

## ef-query-10 | d2
TOPIC: 5.1 EF Core Querying and Tracking
QUALIFIER: BEST
Q:
A list endpoint shows only the Id and Name of each blog, but the Blogs table also has a very large Content column. Which query change BEST reduces the data transferred from the database?
OPT: a
Add AsNoTracking() so EF Core skips change tracking
WHY:
AsNoTracking skips change-tracking setup on the client, but the SQL still selects every column, including Content.
OPT: b
Add AsSplitQuery() so related data loads separately
WHY:
AsSplitQuery only changes how collection Includes are loaded; the blog rows still carry the Content column.
OPT: c *
Project only Id and Name into a DTO with Select()
OPT: d
Call Take(20) on the list returned by ToListAsync()
WHY:
Take after ToListAsync runs in memory, so every row and column has already been transferred before it trims the list.
A:
Project to a DTO with Select before ToListAsync(): EF Core then selects only Id and Name, so the large Content column never leaves the database. Projected DTOs are not tracked either.
USAGE:
List and search endpoints should project to response DTOs; loading full entities only to map them later wastes I/O.
SOURCE: https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries
By using a projection to explicitly choose which columns you want, you can omit big columns and improve performance; note that this is a good idea regardless of data duplication, so consider doing it even when not loading a collection navigation.

## ef-query-11 | d2
TOPIC: 5.1 EF Core Querying and Tracking
Q:
How many times does RunAsync query the database?
```csharp
public class BlogStats(AppDbContext db)
{
    public async Task<int> RunAsync()
    {
        var q = db.Blogs.Where(b => b.Rating > 3);
        var count = await q.CountAsync();
        var list = await q.ToListAsync();
        return count + list.Count;
    }
}
```
OPT: a
Once, when Where runs; CountAsync and ToListAsync read the loaded rows
WHY:
Where on an IQueryable only builds an expression tree; no SQL is sent until a result is consumed.
OPT: b
Once, at CountAsync; ToListAsync reuses the rows that CountAsync fetched
WHY:
CountAsync sends a SELECT COUNT and fetches no rows, and an IQueryable does not cache results between executions.
OPT: c *
Twice: a COUNT query at CountAsync and a SELECT query at ToListAsync
OPT: d
Three times: one each for Where, CountAsync and ToListAsync
WHY:
Building the query with Where does not execute anything; only the two consuming calls reach the database.
A:
Twice: q is only a query definition, so CountAsync sends a COUNT query and ToListAsync sends a separate SELECT. Each consuming call executes the query again; materialize once with ToListAsync and use list.Count if you need both.
USAGE:
Returning IQueryable from a repository invites this: every caller that enumerates it pays another roundtrip.
SOURCE: https://learn.microsoft.com/en-us/ef/core/querying/how-query-works
When you call LINQ operators, you're simply building up an in-memory representation of the query. The query is only sent to the database when the results are consumed.

## ef-query-12 | d2
TOPIC: 5.1 EF Core Querying and Tracking
QUALIFIER: BEST
Q:
A teammate wants the Order entity to be a record, for value equality and `with` expressions. What is the BEST response in an EF Core app?
OPT: a
Accept it, because value equality helps the change tracker detect modified orders
WHY:
EF Core detects changes by comparing property snapshots, not by calling Equals, and it relies on reference identity; value equality lets two distinct instances look like the same entity.
OPT: b *
Keep Order a class, and use records for DTOs and value objects
OPT: c
Accept it, and update orders through `with` expressions so EF Core sees the copy
WHY:
A `with` expression creates a new, untracked instance; the tracked original is unchanged, so SaveChanges writes nothing, and attaching the copy clashes with the tracked instance that has the same key.
OPT: d
Use a record struct instead, so each order is copied rather than shared
WHY:
Copying is exactly what breaks entity identity: EF Core needs one shared instance per entity, and the docs exclude record structs as entity types too.
A:
Keep Order a class and use records for DTOs or value objects. EF Core depends on reference equality so that one instance represents one entity; a record's value equality blurs that identity and `with` produces untracked copies, so Microsoft says records aren't appropriate as EF Core entity types.
USAGE:
Say "entities have identity, DTOs have values"; records fit request/response models and projections, classes fit tracked entities.
SOURCE: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record
Reference equality is required for some data models. For example, Entity Framework Core depends on reference equality to ensure that it uses only one instance of an entity type for what is conceptually one entity. For this reason, records and record structs aren't appropriate for use as entity types in Entity Framework Core.

## ef-query-13 | d2
TOPIC: 5.1 EF Core Querying and Tracking
Q:
Earlier in the same request, a handler loaded product 42 through the same DbContext, which still tracks it. It now needs product 42 again. Which statement about FindAsync(42) and FirstOrDefaultAsync(p => p.Id == 42) is correct?
OPT: a
Both return the tracked instance from memory without querying the database
WHY:
FirstOrDefaultAsync is a LINQ query, so it executes SQL; it only resolves the result to the tracked instance after the roundtrip.
OPT: b *
FindAsync returns the tracked instance without a query; FirstOrDefaultAsync sends SQL
OPT: c
FirstOrDefaultAsync is served from EF Core's query cache, so neither one queries
WHY:
EF Core caches compiled query plans, not query results, so FirstOrDefaultAsync still runs the SQL.
OPT: d
FindAsync queries the database first; FirstOrDefaultAsync checks tracked entities first
WHY:
This reverses the behavior: Find is the method that checks the change tracker before querying.
A:
FindAsync checks the change tracker by primary key and returns the tracked product without a roundtrip, while FirstOrDefaultAsync translates to SQL and queries the database every time it runs.
USAGE:
Find only works by primary key; for any other filter you write a query and accept the roundtrip.
SOURCE: https://learn.microsoft.com/en-us/ef/core/change-tracking/entity-entries
Find first checks if the entity is already tracked, and if so returns the entity immediately. A database query is only made if the entity is not tracked locally.

## ef-query-14 | d3
TOPIC: 5.1 EF Core Querying and Tracking
Q:
A multi-tenant API's DbContext sets its TenantId field, used by a global query filter, inside OnConfiguring. After switching from AddDbContext to AddDbContextPool, what goes wrong?
OPT: a *
OnConfiguring runs only when a pooled instance is first created, so reused instances keep an earlier request's tenant
OPT: b
Nothing changes, because the pool still creates a new instance and runs OnConfiguring for every request
WHY:
The pool hands the same instances back out to later requests; creating one per request is what pooling avoids.
OPT: c
The pooled context is shared by concurrent requests at once, so queries throw concurrency exceptions
WHY:
A pooled instance is leased to one scope at a time and returned when the scope ends; it is not used concurrently.
OPT: d
OnConfiguring now runs before every query, so the extra work cancels out the pooling gain
WHY:
Pooling does not rerun OnConfiguring at all after the instance is created, let alone per query.
A:
OnConfiguring runs only once per pooled instance, when it is first created, so a reused context keeps whichever tenant it was built for and can return another tenant's rows. Per-request state must be set after leasing, for example by a factory that assigns TenantId.
USAGE:
Pooling also resets tracked entities between leases, but your own fields are yours to reset; tenant leaks are a security bug.
SOURCE: https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics
Crucially, the context's OnConfiguring is only invoked once - when the instance context is first created - and so cannot be used to set state which needs to vary (e.g. a tenant ID).

## ef-tx-01 | d1
TOPIC: 5.2 Transactions and Indexes
Q:
You add an Order and three OrderLines to the context, then call SaveChangesAsync once. The INSERT for the third line violates a CHECK constraint. What is left in the database?
A:
Nothing: neither the order nor any of its lines is saved, and SaveChangesAsync throws a DbUpdateException. On a provider that supports transactions, all changes of one SaveChanges call run in a single transaction, so the failed insert rolls back the inserts that already ran.
USAGE:
Say "one SaveChanges is atomic"; you only need an explicit transaction when the unit of work spans several calls.
SOURCE: https://learn.microsoft.com/en-us/ef/core/saving/transactions
By default, if the database provider supports transactions, all changes in a single call to SaveChanges are applied in a transaction. If any of the changes fail, then the transaction is rolled back and none of the changes are applied to the database.

## ef-tx-02 | d1
TOPIC: 5.2 Transactions and Indexes
Q:
The Users table must never hold two rows with the same email, even when two sign-ups arrive at the same moment. How do you make the database reject the duplicate with EF Core, and what does the app see when it happens?
A:
Configure a unique index on Email with HasIndex(u => u.Email).IsUnique() and apply it with a migration. The database then refuses the second insert, so SaveChangesAsync throws a DbUpdateException; the app checks its inner provider exception (e.g. SQL Server error 2601/2627) before answering "email already registered", because FK or length violations also raise DbUpdateException. An AnyAsync pre-check alone races: both requests can pass it.
CODE: csharp
public class AppDbContext : DbContext
{
    public DbSet<User> Users => Set<User>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
        => modelBuilder.Entity<User>().HasIndex(u => u.Email).IsUnique();
}
USAGE:
Keep the pre-check for a friendly message, but let the unique index be the real guarantee.
SOURCE: https://learn.microsoft.com/en-us/ef/core/modeling/indexes
Attempting to insert more than one entity with the same values for the index's column set will cause an exception to be thrown.

## ef-tx-03 | d2
TOPIC: 5.2 Transactions and Indexes
Q:
A transfer saves a debit, reads its generated id, then saves a credit in a second SaveChangesAsync call. How do you make both saves succeed or fail together, and what happens if the code never reaches Commit?
A:
Open an explicit transaction with Database.BeginTransactionAsync, run both SaveChangesAsync calls, then call CommitAsync. Because a transaction is already open, each SaveChanges runs inside it instead of committing on its own, so the debit is not durable until Commit. If Commit is never reached, disposing the transaction rolls it back and neither row persists.
USAGE:
Keep the transaction short: open it right before the first save and never hold it across user input or slow external calls.
SOURCE: https://learn.microsoft.com/en-us/ef/core/saving/transactions
You can use the DbContext.Database API to begin, commit, and rollback transactions. The following example shows two SaveChanges operations and a LINQ query being executed in a single transaction:

## ef-tx-05 | d2
TOPIC: 5.2 Transactions and Indexes
Q:
Two editors load the same Person, which has a [Timestamp] Version property, and both change FirstName. Editor A saves first. What happens when editor B then calls SaveChangesAsync?
OPT: a
B's UPDATE succeeds and silently overwrites the FirstName that editor A just saved
WHY:
That is the behavior without a concurrency token. The token adds Version to the UPDATE's WHERE clause, and A's save changed Version, so B's stale statement cannot match the row.
OPT: b
B's call waits until A's transaction ends, because loading the row took a lock on it
WHY:
Optimistic concurrency takes no locks when reading; nothing blocks, and the conflict is detected only when B's UPDATE runs.
OPT: c *
The UPDATE matches zero rows and SaveChangesAsync throws DbUpdateConcurrencyException
OPT: d
EF Core reloads the row, refreshes Version, and retries B's update without telling the app
WHY:
EF Core does not resolve conflicts by itself. It reports the conflict, and the application decides whether to reload and retry, merge values, or ask the user.
A:
EF Core throws DbUpdateConcurrencyException. The UPDATE is sent with WHERE PersonId = @id AND Version = @original; A's save changed Version, so B's statement affects zero rows and EF Core reports the conflict. The app catches it and chooses: reload and retry, merge, or show the conflict to the user.
USAGE:
In an edit form, round-trip Version in a hidden field so the second save fails instead of silently erasing a colleague's change.
SOURCE: https://learn.microsoft.com/en-us/ef/core/saving/concurrency
However, if a concurrent update occurred, the UPDATE fails to find any matching rows and reports that zero were affected. As a result, EF Core's SaveChanges() throws a DbUpdateConcurrencyException, which the application must catch and handle appropriately.

## ef-tx-06 | d2
TOPIC: 5.2 Transactions and Indexes
QUALIFIER: BEST
Q:
An infinite-scroll feed uses this query. Deep pages are slow, and items get skipped when posts are deleted while users scroll. Which change is BEST?
```csharp
public class FeedService(AppDbContext db)
{
    public Task<List<Post>> GetPageAsync(int page) =>
        db.Posts.OrderBy(p => p.Id)
            .Skip(page * 20)
            .Take(20)
            .ToListAsync();
}
```
OPT: a
Add AsNoTracking() so EF Core skips change tracking for the entities returned on each page
WHY:
Tracking cost depends on the 20 rows returned, which is the same at any depth. The database still reads and discards page × 20 rows, and deletes still shift the offset.
OPT: b
Raise the page size to 100 so users reach deep content in fewer round trips
WHY:
Fewer requests, but each one still uses OFFSET and discards every earlier row, and a delete still shifts the window, so items keep getting skipped.
OPT: c
Load the full ordered list once per user, cache it, and slice pages from it in memory
WHY:
It reads the whole table per user and holds it in memory, and the cached copy goes stale: new posts never appear and deleted ones still show.
OPT: d *
Pass the last seen Id and filter Where(p => p.Id > lastId) before Take(20), dropping Skip
A:
Keyset pagination: filter on the last seen Id instead of skipping. With an index on Id the database seeks straight to the next row instead of reading and discarding page × 20 rows, and because the position is a key value rather than an offset, deletes no longer shift the window.
USAGE:
Return the last Id as a cursor token; if users must jump to page N, keep offset paging only for that jump.
SOURCE: https://learn.microsoft.com/en-us/ef/core/querying/pagination
The recommended alternative to offset-based pagination - sometimes called keyset pagination or seek-based pagination - is to simply use a WHERE clause to skip rows, instead of an offset. This means remember the relevant values from the last entry fetched (instead of its offset), and to ask for the next rows after that row.

## ef-tx-04 | d3
TOPIC: 5.2 Transactions and Indexes
Q:
After adding EnableRetryOnFailure, code that calls BeginTransactionAsync now throws InvalidOperationException. Why does a retrying execution strategy conflict with a user transaction, and how do you fix it?
A:
The strategy retries each query or SaveChanges as its own unit, but it cannot replay the earlier work inside your transaction, so it refuses user-initiated transactions. Fix: get Database.CreateExecutionStrategy() and run the whole transaction (begin, saves, commit) inside strategy.ExecuteAsync, so a transient failure re-runs the delegate from the start. Create the context inside the delegate, because it may run more than once.
CODE: csharp
using var outer = new AppDbContext();
var strategy = outer.Database.CreateExecutionStrategy();
await strategy.ExecuteAsync(async () =>
{
    using var db = new AppDbContext();
    await using var tx = await db.Database.BeginTransactionAsync();
    db.Orders.Add(new Order());
    await db.SaveChangesAsync();
    await tx.CommitAsync();
});
USAGE:
Common on Azure SQL: retries are enabled for transient faults, and every hand-written transaction must then move inside ExecuteAsync.
SOURCE: https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency
The solution is to manually invoke the execution strategy with a delegate representing everything that needs to be executed. If a transient failure occurs, the execution strategy will invoke the delegate again.

## net-test-01 | d1
TOPIC: 6.1 Unit and Integration Testing
Q:
A test calls `OrderRepository.GetByIdAsync`, which queries a real SQL Server database. Is it a unit test or an integration test, and why does the label matter?
A:
It is an integration test, because it exercises infrastructure (the database) together with your code. Unit tests cover only code you control and fake the infrastructure, so they stay fast and repeatable; keeping the two kinds apart lets unit tests run on every build while the slower integration suite runs separately.
USAGE:
Keep unit and integration tests in separate projects so infrastructure packages never leak into the unit test project.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/testing/
Unit tests should only test code within the developer's control. They don't test infrastructure concerns. Infrastructure concerns include interacting with databases, file systems, and network resources.

## net-test-02 | d1
TOPIC: 6.1 Unit and Integration Testing
Q:
`IsPrime` must return false for -1, 0 and 1. Instead of copying a `[Fact]` test three times, what does xUnit give you, and what changes in the test method?
A:
Use one `[Theory]` method that takes an `int value` parameter and carries `[InlineData(-1)]`, `[InlineData(0)]` and `[InlineData(1)]`. xUnit runs each data row as its own test case and passes the value in, so the logic exists once and a failure names the exact input that broke.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-csharp-with-xunit
[Theory] represents a suite of tests that execute the same code but have different input arguments.

## net-test-03 | d1
TOPIC: 6.1 Unit and Integration Testing
Q:
A teammate writes a test as `var calc = new StringCalculator(); Assert.Equal(0, calc.Add(""));`. Why do teams prefer an explicit Arrange, Act, Assert layout with a single Act step instead?
A:
Because it separates the call under test from the setup and from the check, so one Act line shows exactly which behavior the test exercises. When the call hides inside an assertion, behavior and verification mix, and a failing test is harder to read and diagnose.
USAGE:
If a test needs two Act steps, split it into two tests or a `[Theory]`.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices
When you follow the pattern, you can clearly separate what is being tested from the Arrange and Assert tasks. The pattern also helps to reduce the opportunity for assertions to intermix with code in the Act task.

## net-test-04 | d1
TOPIC: 6.1 Unit and Integration Testing
QUALIFIER: BEST
Q:
Public `ParseLogLine` calls a private `TrimInput` helper. You want a test proving that log lines are trimmed. Which approach is BEST?
OPT: a
Call the private `TrimInput` method from the test through reflection
WHY:
Reflection ties the test to a private name and signature, so a harmless refactor breaks it, and it still does not show that `ParseLogLine` uses the trimmed value.
OPT: b
Make `TrimInput` public so the test can call it directly
WHY:
It widens the class's API only for testing, and a passing `TrimInput` test does not prove `ParseLogLine` returns the trimmed result.
OPT: c *
Test `ParseLogLine` with an input like `" a "` and assert it returns `"a"`
OPT: d
Make `TrimInput` internal and expose it with `InternalsVisibleTo` for the test project
WHY:
It still tests an implementation detail; `ParseLogLine` could alter the sanitized value afterwards and this test would keep passing.
A:
Testing `ParseLogLine` with padded input verifies the behavior callers depend on. The private helper is an implementation detail: a passing test on it does not prove the public method uses its result correctly, and renaming or inlining it would break the test for no reason.
USAGE:
If a private method feels like it needs its own tests, that is often a sign it belongs in a separate class with a public API.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices
When you encounter a private method, locate the public method that calls the private method, and write your tests against the public method. Just because a private method returns an expected result, doesn't mean the system that eventually calls the private method uses the result correctly.

## net-test-05 | d2
TOPIC: 6.1 Unit and Integration Testing
Q:
In this test, is `order` a stub or a mock, and what change would make it the other one?
```csharp
public class PurchaseTests
{
    [Fact] public void ValidateOrders_ValidatesTheOrder()
    {
        var order = new FakeOrder();
        var purchase = new Purchase(order);
        purchase.ValidateOrders();
        Assert.True(order.Validated);
    }
}
```
A:
It is a mock, because the test asserts against the fake itself (`order.Validated`), so the fake decides whether the test passes. If the test asserted `purchase.CanBeShipped` instead and `order` only satisfied the constructor, the same `FakeOrder` would be a stub. Naming it correctly tells reviewers whether the test verifies an interaction or an outcome.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices
The main thing to remember about mocks versus stubs is that mocks are just like stubs, except for the Assert process. You run Assert operations against a mock object, but not against a stub.

## net-test-06 | d2
TOPIC: 6.1 Unit and Integration Testing
Q:
In a minimal-hosting app, the test project's `WebApplicationFactory<Program>` does not compile because `Program` is inaccessible. Why, and what one-line change in Program.cs fixes it?
A:
Top-level statements make the compiler generate an implicit `Program` class that is internal, so the test assembly cannot name it. Adding `public partial class Program { }` at the end of Program.cs merges with the generated class and makes it public. Granting the test project `InternalsVisibleTo` in the web project's .csproj is the alternative that keeps it internal.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests?view=aspnetcore-8.0
Make the Program class public using a partial class declaration:

## net-test-08 | d2
TOPIC: 6.1 Unit and Integration Testing
Q:
A `TokenService` reads `DateTime.UtcNow`, and tokens expire after 15 minutes. How do you unit test the expiry on .NET 8 without `Thread.Sleep` or writing your own `IClock` interface?
A:
Inject `TimeProvider` and read `GetUtcNow()` from it; production registers `TimeProvider.System`, and the test passes a `FakeTimeProvider` from Microsoft.Extensions.TimeProvider.Testing. `Advance(TimeSpan.FromMinutes(15))` moves the clock instantly, so the test is fast and deterministic, and the abstraction ships with .NET 8 instead of being hand-rolled.
CODE: csharp
// inside a [Fact] test method
var time = new FakeTimeProvider();
var tokens = new TokenService(time);
var token = tokens.Issue("alice");
time.Advance(TimeSpan.FromMinutes(15));
Assert.True(tokens.IsExpired(token));
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview
The Microsoft.Extensions.TimeProvider.Testing NuGet package provides a controllable TimeProvider implementation designed for unit testing.

## net-test-09 | d2
TOPIC: 6.1 Unit and Integration Testing
Q:
Code under test calls `Database.BeginTransaction()` and relies on rollback. The test configures `UseInMemoryDatabase` with default options. What happens when the transaction starts?
OPT: a
The provider simulates the transaction, so a rollback discards the changes as SQL Server would
WHY:
The in-memory provider has no transaction support, so nothing can be rolled back and rollback-dependent behavior cannot be reproduced.
OPT: b *
EF Core throws an exception, because the in-memory provider does not support transactions
OPT: c
The call is silently ignored and the test continues without transactional semantics
WHY:
That happens only after you configure EF Core to ignore `InMemoryEventId.TransactionIgnoredWarning`; with default options the warning surfaces as an exception.
OPT: d
EF Core switches to an in-memory SQLite database to provide the transaction
WHY:
EF Core does not swap providers on its own; SQLite in-memory must be configured explicitly with `UseSqlite` over a connection the test keeps open.
A:
By default the in-memory provider throws when a transaction starts, because it does not support transactions. Ignoring `TransactionIgnoredWarning` removes the exception but rollback still does nothing, so code that depends on transactional semantics must be tested against SQLite or the real database.
USAGE:
EF Core docs strongly discourage the in-memory provider for testing; prefer SQLite in-memory, a repository fake, or the real database.
SOURCE: https://learn.microsoft.com/en-us/ef/core/testing/testing-without-the-database
Note that by default, if a transaction is started, the in-memory provider will throw an exception since transactions aren't supported. You may wish to have transactions silently ignored instead, by configuring EF Core to ignore InMemoryEventId.TransactionIgnoredWarning as in the above sample.

## net-test-10 | d2
TOPIC: 6.1 Unit and Integration Testing
QUALIFIER: BEST
Q:
Every test in an xUnit test class needs a `WebApplicationFactory<Program>`, which is slow to start. Which is the BEST way to build it once and share it across that class's tests?
OPT: a
Create the factory in the test class constructor and keep it in a private readonly field
WHY:
xUnit creates a new instance of the test class for every test, so the constructor runs per test and the slow factory is rebuilt each time.
OPT: b *
Implement `IClassFixture<WebApplicationFactory<Program>>` and take the factory as a constructor parameter
OPT: c
Implement `IAsyncLifetime` on the test class and build the factory in `InitializeAsync`
WHY:
On a test class, `IAsyncLifetime` runs `InitializeAsync` for each new class instance, so once per test, and the slow factory is still rebuilt every time.
OPT: d
Keep the factory in a `static` field that the first test initializes lazily and later tests reuse
WHY:
Nothing disposes a static field, so the TestServer and host outlive the class, and you hand-roll lifetime management that `IClassFixture<T>` already provides.
A:
`IClassFixture<T>` makes xUnit create the factory once and inject it into every test of the class. xUnit disposes it after the class's last test. Because xUnit builds a new test-class instance per test, state created in the constructor alone is rebuilt for every test.
USAGE:
Use `ICollectionFixture<T>` when several test classes must share one instance.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests?view=aspnetcore-8.0
Test classes implement a class fixture interface (IClassFixture) to indicate the class contains tests and provide shared object instances across the tests in the class.

## net-test-11 | d2
TOPIC: 6.1 Unit and Integration Testing
QUALIFIER: BEST
Q:
Tests share a `WebApplicationFactory` through a class fixture. One test must replace the app's `IQuoteService` with a stub without affecting the others. Which approach is BEST?
OPT: a *
Use `WithWebHostBuilder` in that test and register the stub inside `ConfigureTestServices`
OPT: b
Override `ConfigureWebHost` in the shared custom factory to register the stub
WHY:
The shared factory builds the host every test in the class uses, so all of them would get the stub, not only this one.
OPT: c
Resolve `IQuoteService` from `_factory.Services` and assign a stub to it
WHY:
Resolving returns an instance of the registered `QuoteService`; it cannot change the registration, because the container is already built.
OPT: d
Register the stub in Program.cs when the environment name is `Testing`
WHY:
It puts test code into production startup and applies to every test that runs in that environment, not to one test.
A:
`WithWebHostBuilder` creates a new factory just for that test. Its `ConfigureTestServices` callback runs after the app's own registrations, so the stub replaces `QuoteService` only in that test's host, while the shared factory and every other test keep the real service.
USAGE:
The same pattern swaps in a test authentication handler for one test that needs a signed-in user.
SOURCE: https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests?view=aspnetcore-8.0
Services can be overridden in a test with a call to ConfigureTestServices on the host builder. To scope the overridden services to the test itself, the WithWebHostBuilder method is used to retrieve a host builder.

## net-test-12 | d2
TOPIC: 6.1 Unit and Integration Testing
QUALIFIER: BEST
Q:
A typed-client service calls `HttpClient.GetAsync`. In a unit test, the service must receive a canned 404 response. Which approach is BEST?
OPT: a
Mock `HttpClient` with a mocking library and set up `GetAsync` to return 404
WHY:
`GetAsync` is not virtual, so proxy-based libraries such as Moq cannot intercept it on a concrete `HttpClient`; the setup fails.
OPT: b *
Construct the client with a fake handler whose `SendAsync` returns a 404
OPT: c
Subclass `HttpClient` and declare a `new GetAsync` that returns the 404
WHY:
Hiding with `new` is resolved at compile time; the service calls through an `HttpClient` reference, so it still runs the base `GetAsync`.
OPT: d
Point the client at the real API with an ID that does not exist
WHY:
That turns it into an integration test that depends on the network and remote data, so it is slow and can fail for reasons outside your code.
A:
Passing a fake handler to the `HttpClient(HttpMessageHandler)` constructor works because `HttpClient`'s async methods, including `GetAsync`, end in the handler's `SendAsync`. Overriding it to return `new HttpResponseMessage(HttpStatusCode.NotFound)` controls the response with no network, and the service code runs unchanged.
USAGE:
The same handler can record the outgoing `HttpRequestMessage`, so the test can also assert the URL and headers the service sent.
SOURCE: https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpmessagehandler?view=net-8.0
So if a handler is assigned to an HttpClient instance, the SendAsync method of the handler may get called concurrently by the HttpClient instance and needs to be thread safe.

## net-design-01 | d1
TOPIC: 7.1 Design Principles
Q:
An `OrderService` validates orders, saves them to the database, and builds the HTML confirmation email. A reviewer says it breaks the single responsibility principle. What do they mean, and what would you split out first?
A:
It has three unrelated reasons to change (validation rules, persistence, email layout), so a template tweak forces you to edit and retest order logic. Extract the email building into its own class first, then move persistence behind a separate data-access type, leaving `OrderService` with order rules only.
USAGE:
Phrase SRP as "one reason to change", not "one method"; reviewers care about which change requests touch the class.
SOURCE: https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/architectural-principles
It states that objects should have only one responsibility and that they should have only one reason to change. Specifically, the only situation in which the object should change is if the manner in which it performs its one responsibility must be updated.

## net-design-02 | d1
TOPIC: 7.1 Design Principles
Q:
A candidate says "DIP and DI are the same thing: it's the container in Program.cs." How do you correct them?
A:
DIP is a design rule (high-level code depends on abstractions, not implementation details); DI is a technique for handing a class its dependencies from outside. Following DIP is what makes DI useful for swapping implementations, and a container only automates the wiring: `new OrderService(new SqlOrderRepository())` is DI too, and injecting a concrete class is DI without DIP.
SOURCE: https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/architectural-principles
Dependency inversion is a key part of building loosely coupled applications, since implementation details can be written to depend on and implement higher-level abstractions, rather than the other way around. The resulting applications are more testable, modular, and maintainable as a result. The practice of dependency injection is made possible by following the dependency inversion principle.

## net-design-03 | d2
TOPIC: 7.1 Design Principles
Q:
Every new carrier means editing, retesting and redeploying this class. Which design principle is strained, and how would you restructure it?
```csharp
public class ShippingService
{
    public decimal Cost(Order order) => order.Carrier switch
    {
        "UPS" => 5m + order.WeightKg * 1.2m,
        "DHL" => 7m + order.WeightKg * 0.9m,
        _ => throw new NotSupportedException(order.Carrier)
    };
}
```
A:
The open/closed principle: the class should be open for extension but closed for modification, yet each carrier edits it. Define `IShippingRateCalculator` with `Carrier` and `Cost(Order)`, write one class per carrier, register each in DI, and let `ShippingService` take `IEnumerable<IShippingRateCalculator>` and pick by `Carrier`. A new carrier is then a new class plus one registration, so existing carriers' tested code stays untouched.
SOURCE: https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/develop-asp-net-core-mvc-apps
Dependency injection is based on the dependency inversion principle, and is often key to achieving the open/closed principle.

## net-design-04 | d2
TOPIC: 7.1 Design Principles
Q:
In a Core / Infrastructure / Web solution, a teammate adds a project reference from Core to Infrastructure so a domain service can call `SmtpEmailSender` directly. What is wrong, and where should `IEmailSender` and `SmtpEmailSender` live?
A:
The dependency points outward: Core must not depend on Infrastructure. Put `IEmailSender` in Core and `SmtpEmailSender` in Infrastructure, which references Core, and let Web register the implementation in DI. Business logic then compiles against the interface only, so it can be unit tested with a fake sender and SMTP can be replaced without touching Core; and because Infrastructure normally references Core already, the new reference would create a cycle that does not build.
SOURCE: https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures
Instead of having business logic depend on data access or other infrastructure concerns, this dependency is inverted: infrastructure and implementation details depend on the Application Core. This functionality is achieved by defining abstractions, or interfaces, in the Application Core, which are then implemented by types defined in the Infrastructure layer.

## net-design-06 | d2
TOPIC: 7.1 Design Principles
Q:
Your team ships a payments SDK as a NuGet package that other teams consume. It supports one provider, but a teammate wants to add a public plugin interface, provider factory and strategy registry "in case we add more someday". What is the argument against it, and when would you add that flexibility?
A:
Choose the least costly mechanism that meets today's requirement, and add the extension point when a second provider actually exists. Adding extensibility later is usually possible, but once consuming teams build against a public plugin interface, removing or reshaping it is a breaking change, so a speculative seam that guessed wrong becomes permanent cost on top of the code, tests and indirection it adds now.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/designing-for-extensibility
For any given extensibility requirement, you should choose the least costly extensibility mechanism that meets the requirements. Keep in mind that it’s usually possible to add more extensibility later, but you can never take it away without introducing breaking changes.

## net-design-07 | d2
TOPIC: 7.1 Design Principles
QUALIFIER: BEST
Q:
`ReceiptService` sends 500-character receipts through `INotifier` and crashes once DI wires `SmsNotifier`. Which is the BEST description of the design flaw?
```csharp
public interface INotifier { void Send(string to, string msg); }
public class EmailNotifier : INotifier { public void Send(string to, string msg) { } }
public class SmsNotifier : INotifier
{
    public void Send(string to, string msg)
    {
        if (msg.Length > 160) throw new ArgumentException("SMS is limited to 160 characters");
    }
}
public class ReceiptService(INotifier notifier) { public void Send(string to, string r) => notifier.Send(to, r); }
```
OPT: a *
`SmsNotifier` rejects messages over 160 characters, a precondition the `INotifier` contract does not state
OPT: b
`ReceiptService` is at fault; it should check `notifier is SmsNotifier` and truncate the receipt before calling `Send`
WHY:
Type checks in the caller patch one implementation and break with the next; needing them proves the implementations are not substitutable.
OPT: c
`SmsNotifier` mixes two responsibilities, validating and sending, so it should be split into two separate classes
WHY:
Moving the length check into another class still leaves an implementation refusing input the contract accepts; the flaw is the broken contract, not class size.
OPT: d
`INotifier` should be an abstract class, because overrides of abstract methods cannot throw exceptions the base does not
WHY:
C# has no checked exceptions; an override can throw anything, so an abstract class changes nothing here.
A:
`SmsNotifier` adds a precondition the `INotifier` contract does not state, so it cannot substitute for other implementations: a Liskov substitution violation. Fix it by making the limit part of the contract (documented, or exposed as a capability) or by having `SmsNotifier` honor the contract, for example by splitting long messages.
USAGE:
A quick LSP smell test: if callers need `is`/`as` checks or try/catch around one implementation, that implementation breaks the contract.
SOURCE: https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/abstractions-abstract-types-and-interfaces
Abstractions are usually implemented as abstract classes or interfaces, and they come with a well-defined set of reference documentation describing the required semantics of the types implementing the contract.

## net-design-08 | d2
TOPIC: 7.1 Design Principles
QUALIFIER: BEST
Q:
`ReceiptMailer` injects `IOptions<AppSettings>`, a class holding 30 settings for every feature, but reads only `SmtpHost` and `SmtpPort`. Which change BEST applies the interface segregation principle?
OPT: a *
Bind a small `SmtpOptions` class to its own `Smtp` section and inject `IOptions<SmtpOptions>`
OPT: b
Inject `IConfiguration` and read the `Smtp:Host` and `Smtp:Port` keys by string in the constructor
WHY:
The mailer then depends on the entire configuration tree, a wider surface than before, and it loses typed binding and validation.
OPT: c
Switch to `IOptionsMonitor<AppSettings>` so the mailer picks up SMTP changes without an app restart
WHY:
This changes reload behavior, not the width of the dependency; the mailer still depends on all 30 settings.
OPT: d
Split `AppSettings` across partial class files, one file per feature, keeping the single type
WHY:
Partial class files compile into one type, so every consumer still depends on all of its settings.
A:
Binding a dedicated `SmtpOptions` class to its own section and injecting `IOptions<SmtpOptions>` makes the mailer depend only on the two settings it uses, so unrelated settings cannot affect it and tests supply just two values.
USAGE:
Register it with `builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection("Smtp"))`; one options class per feature section is the usual layout.
SOURCE: https://learn.microsoft.com/en-us/dotnet/core/extensions/options
The Interface Segregation Principle (ISP) or Encapsulation: Scenarios (classes) that depend on configuration settings depend only on the configuration settings that they use.

## net-design-05 | d3
TOPIC: 7.1 Design Principles
Q:
A small CRUD API wraps `DbContext` in a generic `IRepository<T>` with `Add`, `GetById` and `Update`. A reviewer calls it redundant. When is a custom repository over EF Core worth it, and what does it cost?
A:
For simple CRUD it is redundant: `DbContext` already acts as a unit of work and each `DbSet<T>` as a repository, so use them directly. An aggregate-specific repository pays off in richer domains, because it keeps domain code persistence-ignorant and lets tests use fake repositories. The cost is that a generic wrapper hides EF features such as `Include`, projections and `AsNoTracking`, or leaks `IQueryable` and stops abstracting anything.
USAGE:
Answer with "it depends on domain complexity" and name both the testing gain and the lost EF features.
SOURCE: https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-implementation-entity-framework-core
The Entity Framework DbContext class is based on the Unit of Work and Repository patterns and can be used directly from your code, such as from an ASP.NET Core MVC controller. The Unit of Work and Repository patterns result in the simplest code, as in the CRUD catalog microservice in eShopOnContainers. In cases where you want the simplest code possible, you might want to directly use the DbContext class, as many developers do.
