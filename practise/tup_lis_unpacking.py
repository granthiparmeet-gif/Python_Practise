x = ("Appple", "Banana", "Cherry", "Donkey", "Elephant")
y = ["Car", "Cycle","Bike", "Areoplane", "Ship"]

(a,b,*d,e) = x
[j,k,*l, m] = y

print(f"{a} {b} {d} {e} \n {j} {k} {l} {m}")