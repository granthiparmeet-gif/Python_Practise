x = int(input("Enter the integer: "))

num = [0,1]

for i in range(2,x):
   next_num = num[-1] + num[-2] #This logic will give the next nunber as the sum of last and second last number
   num.append(next_num)

print(num)